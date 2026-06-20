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
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/metrics"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func main() {
	// .env is optional — env vars from the shell win.
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

	h := hub.New()

	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Recover())
	e.Use(middleware.Logger())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: cfg.AllowedOrigins,
		AllowMethods: []string{http.MethodGet, http.MethodOptions},
	}))

	e.GET("/healthz", func(c echo.Context) error { return c.String(http.StatusOK, "ok") })
	e.GET("/api/history", handler.History(pool))
	e.GET("/ws", handler.WebSocket(h, cfg.AllowedOrigins))

	go runBroadcaster(ctx, h, pool, cfg.PushHz)

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
	_ = e.Shutdown(shutdownCtx)
}

// runBroadcaster generates dummy samples at PushHz, persists them to PG
// (async, best-effort), and fans them out to every WebSocket client.
func runBroadcaster(ctx context.Context, h *hub.Hub, pool *pgxpool.Pool, hz int) {
	if hz < 1 {
		hz = 1
	}
	interval := time.Second / time.Duration(hz)
	tick := time.NewTicker(interval)
	defer tick.Stop()

	gen := metrics.NewGenerator()

	persistCh := make(chan persistJob, 1024)
	for i := 0; i < 2; i++ {
		go persistWorker(ctx, pool, persistCh)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			s := gen.Next(now, db.MetricNames)
			payload, err := json.Marshal(s)
			if err != nil {
				continue
			}
			h.Broadcast(payload)

			for name, v := range s.Values {
				select {
				case persistCh <- persistJob{ts: now, name: name, value: v}:
				default:
					// drop — DB is behind, prefer fresh broadcast over storage
				}
			}
		}
	}
}

type persistJob struct {
	ts    time.Time
	name  string
	value float64
}

func persistWorker(ctx context.Context, pool *pgxpool.Pool, jobs <-chan persistJob) {
	for {
		select {
		case <-ctx.Done():
			return
		case j, ok := <-jobs:
			if !ok {
				return
			}
			db.InsertSample(ctx, pool, j.ts, j.name, j.value)
		}
	}
}
