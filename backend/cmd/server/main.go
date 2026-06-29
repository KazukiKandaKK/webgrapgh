package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/config"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/handler"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/hub"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/logs"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/watcher"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/time/rate"
)

// The server no longer generates samples itself — that's now cmd/writer's job.
// The server only:
//  1. serves REST/WS endpoints
//  2. watches PostgreSQL for new rows (LISTEN metrics_new) and broadcasts
//     them on /ws
//  3. generates and broadcasts synthetic log events (in-memory; no DB)
func main() {
	_ = godotenv.Load(".env")
	_ = godotenv.Load("../.env")

	cfg := config.Load()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.Connect(ctx, cfg.PostgresDSN())
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := db.EnsureSchema(ctx, pool); err != nil {
		log.Fatalf("schema: %v", err)
	}
	if err := db.SeedIfEmpty(ctx, pool, cfg.SeedPointsPerMetric); err != nil {
		log.Fatalf("seed: %v", err)
	}

	metricHub := hub.New()
	logHub := hub.New()
	canvasHub := hub.New()
	containerHub := hub.New()

	logStore := logs.NewStore(30000)
	logs.SeedHistory(logStore, time.Hour, 5000)
	log.Printf("logs: seeded %d events (capacity=%d)", logStore.Size(), logStore.Capacity())

	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Recover())
	e.Use(middleware.Logger())
	e.Use(securityHeaders())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: cfg.AllowedOrigins,
		AllowMethods: []string{http.MethodGet, http.MethodOptions},
	}))
	e.Use(middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
		Skipper: func(c echo.Context) bool {
			// Skip rate limiting for WebSocket upgrades (they have their own
			// connection-count limit via the hub).
			return c.Request().Header.Get("Upgrade") == "websocket"
		},
		Store: middleware.NewRateLimiterMemoryStoreWithConfig(
			middleware.RateLimiterMemoryStoreConfig{
				Rate:      rate.Limit(20),
				Burst:     40,
				ExpiresIn: 3 * time.Minute,
			},
		),
		IdentifierExtractor: func(c echo.Context) (string, error) {
			return c.RealIP(), nil
		},
	}))

	e.GET("/healthz", func(c echo.Context) error { return c.String(http.StatusOK, "ok") })
	e.GET("/api/history", handler.History(pool))
	e.GET("/api/logs/history", handler.LogsHistory(logStore))
	e.GET("/api/containers/history", handler.ContainersHistory(pool))
	e.GET("/ws", handler.WebSocket(metricHub, cfg.AllowedOrigins))
	e.GET("/ws/logs", handler.WebSocket(logHub, cfg.AllowedOrigins))
	// Fed by container_metrics rows that cmd/collector INSERTs.
	e.GET("/ws/containers", handler.WebSocket(containerHub, cfg.AllowedOrigins))
	// Yjs CRDT relay for the whiteboard. Server is stateless — peers sync
	// each other via the y-websocket protocol; we only fan out binary frames.
	// y-websocket appends the room name as a path segment (/ws/canvas/<room>),
	// so we register both the bare path and the parameterized one. Today the
	// hub is global; the room param is accepted but ignored.
	canvasH := handler.CanvasWebSocket(canvasHub, cfg.AllowedOrigins)
	e.GET("/ws/canvas", canvasH)
	e.GET("/ws/canvas/:room", canvasH)

	// Data retention: periodically purge rows older than 24h.
	go db.RunRetention(ctx, pool, db.DefaultRetention)

	// /ws is fed by rows the writer process(es) INSERT into `metrics`.
	go watcher.Run(ctx, pool, metricHub)
	// /ws/containers is fed by rows cmd/collector INSERTs into `container_metrics`.
	go watcher.RunContainers(ctx, pool, containerHub)
	// Logs are in-memory only; no DB writer is involved.
	go runLogBroadcaster(ctx, logHub, logStore, cfg.LogPushHz)

	addr := fmt.Sprintf(":%d", cfg.BackendPort)
	go func() {
		log.Printf("listening on %s", addr)
		if err := e.Start(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutting down…")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

// securityHeaders adds standard hardening headers to every HTTP response.
func securityHeaders() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			h := c.Response().Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			h.Set("Content-Security-Policy",
				"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'")
			return next(c)
		}
	}
}

// runLogBroadcaster emits synthetic log events at LogPushHz, stores them in
// the in-memory ring, and fans them out to /ws/logs subscribers.
func runLogBroadcaster(ctx context.Context, h *hub.Hub, store *logs.Store, hz int) {
	if hz < 1 {
		hz = 1
	}
	interval := time.Second / time.Duration(hz)
	tick := time.NewTicker(interval)
	defer tick.Stop()

	gen := logs.NewGenerator()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			ev := store.Append(gen.Next(now))
			payload, err := json.Marshal(ev)
			if err != nil {
				log.Printf("logBroadcaster: marshal: %v", err)
				continue
			}
			h.Broadcast(payload)
		}
	}
}
