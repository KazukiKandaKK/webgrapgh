// Command bff is the Backend-for-Frontend.
//
// Public side (same shapes as the monolith — frontend doesn't need to change):
//
//	GET  /healthz
//	GET  /api/history?metrics=cpu,...&minutes=60&max_points=5000
//	GET  /api/logs/history?limit=10000
//	WS   /ws         server → client streaming of metric ticks
//	WS   /ws/logs    server → client streaming of log events
//
// Internal side: gRPC clients to MetricsService and LogService. One gRPC
// stream per upstream service is shared across all browser WS clients by
// fanning out through a local Hub.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	logspb "github.com/KazukiKandaKK/webgrapgh/aws-microservices/proto/logs"
	metricspb "github.com/KazukiKandaKK/webgrapgh/aws-microservices/proto/metrics"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type config struct {
	port           int
	metricsAddr    string
	logsAddr       string
	allowedOrigins []string
}

func loadConfig() config {
	return config{
		port:           getEnvInt("PORT", 8080),
		metricsAddr:    getEnv("METRICS_ADDR", "metrics-service:50051"),
		logsAddr:       getEnv("LOGS_ADDR", "logs-service:50052"),
		allowedOrigins: splitCSV(getEnv("ALLOWED_ORIGINS", "http://localhost:3000")),
	}
}

func main() {
	cfg := loadConfig()
	ctx, cancel := signal.NotifyContext(
		context.Background(), syscall.SIGINT, syscall.SIGTERM,
	)
	defer cancel()

	metricsConn, err := dialGRPC(ctx, cfg.metricsAddr)
	if err != nil {
		log.Fatalf("bff: dial metrics %s: %v", cfg.metricsAddr, err)
	}
	defer metricsConn.Close()
	metricsClient := metricspb.NewMetricsServiceClient(metricsConn)

	logsConn, err := dialGRPC(ctx, cfg.logsAddr)
	if err != nil {
		log.Fatalf("bff: dial logs %s: %v", cfg.logsAddr, err)
	}
	defer logsConn.Close()
	logsClient := logspb.NewLogServiceClient(logsConn)

	metricsHub := NewHub()
	logsHub := NewHub()

	// One upstream stream per service, fanned out to N browser WS clients.
	go runMetricsBridge(ctx, metricsClient, metricsHub)
	go runLogsBridge(ctx, logsClient, logsHub)

	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Recover())
	e.Use(middleware.Logger())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: cfg.allowedOrigins,
		AllowMethods: []string{http.MethodGet, http.MethodOptions},
	}))

	e.GET("/healthz", func(c echo.Context) error { return c.String(http.StatusOK, "ok") })
	e.GET("/api/history", historyHandler(metricsClient))
	e.GET("/api/logs/history", logsHistoryHandler(logsClient))
	e.GET("/ws", WSHandler(metricsHub, cfg.allowedOrigins))
	e.GET("/ws/logs", WSHandler(logsHub, cfg.allowedOrigins))

	addr := fmt.Sprintf(":%d", cfg.port)
	go func() {
		log.Printf("bff: listening on %s (metrics=%s, logs=%s)",
			addr, cfg.metricsAddr, cfg.logsAddr)
		if err := e.Start(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("bff: serve: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("bff: shutting down")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = e.Shutdown(shutdownCtx)
}

// dialGRPC retries with backoff until the upstream answers or ctx expires.
// In docker-compose ordering, BFF often starts before metrics/logs accept.
func dialGRPC(ctx context.Context, addr string) (*grpc.ClientConn, error) {
	backoff := 250 * time.Millisecond
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		conn, err := grpc.NewClient(addr,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		)
		if err == nil {
			return conn, nil
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
		}
		if backoff < 4*time.Second {
			backoff *= 2
		}
	}
	return nil, fmt.Errorf("after retries: %w", lastErr)
}

// ---------- streaming bridges ----------

// runMetricsBridge keeps a single StreamRealtime open to the metrics service
// and re-serializes each Tick as the monolith's WireSample JSON.
func runMetricsBridge(ctx context.Context, client metricspb.MetricsServiceClient, h *Hub) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := metricsStreamOnce(ctx, client, h)
		if ctx.Err() != nil {
			return
		}
		log.Printf("bff: metrics stream ended (%v); reconnecting in %s", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 10*time.Second {
			backoff *= 2
		}
	}
}

func metricsStreamOnce(ctx context.Context, client metricspb.MetricsServiceClient, h *Hub) error {
	stream, err := client.StreamRealtime(ctx, &metricspb.StreamRequest{})
	if err != nil {
		return fmt.Errorf("open: %w", err)
	}
	log.Println("bff: metrics stream open")
	for {
		tick, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		payload, mErr := json.Marshal(wireSample{T: tick.TimestampMs, V: tick.Values})
		if mErr != nil {
			continue
		}
		h.Broadcast(payload)
	}
}

func runLogsBridge(ctx context.Context, client logspb.LogServiceClient, h *Hub) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := logsStreamOnce(ctx, client, h)
		if ctx.Err() != nil {
			return
		}
		log.Printf("bff: logs stream ended (%v); reconnecting in %s", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 10*time.Second {
			backoff *= 2
		}
	}
}

func logsStreamOnce(ctx context.Context, client logspb.LogServiceClient, h *Hub) error {
	stream, err := client.StreamRealtime(ctx, &logspb.StreamRequest{})
	if err != nil {
		return fmt.Errorf("open: %w", err)
	}
	log.Println("bff: logs stream open")
	for {
		ev, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		payload, mErr := json.Marshal(wireLog{
			ID:      ev.Id,
			T:       ev.TimestampMs,
			Level:   ev.Level,
			Source:  ev.Source,
			Message: ev.Message,
		})
		if mErr != nil {
			continue
		}
		h.Broadcast(payload)
	}
}

// ---------- REST handlers ----------

// historyHandler keeps the exact shape of the monolith's /api/history so the
// browser worker needs no changes: {"metrics":{"cpu":{"t":[...],"v":[...]},...}}.
func historyHandler(client metricspb.MetricsServiceClient) echo.HandlerFunc {
	return func(c echo.Context) error {
		names := MetricsAll
		if q := c.QueryParam("metrics"); q != "" {
			names = splitCSV(q)
		}
		minutes := 60
		if q := c.QueryParam("minutes"); q != "" {
			if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 24*60 {
				minutes = n
			}
		}
		maxPoints := 0
		if q := c.QueryParam("max_points"); q != "" {
			if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 100000 {
				maxPoints = n
			}
		}

		ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
		defer cancel()

		stream, err := client.GetHistory(ctx, &metricspb.HistoryRequest{
			MetricNames:     names,
			FromTimestampMs: time.Now().Add(-time.Duration(minutes) * time.Minute).UnixMilli(),
			MaxPoints:       int32(maxPoints),
		})
		if err != nil {
			return echo.NewHTTPError(http.StatusBadGateway, err.Error())
		}

		series := make(map[string]*historySeries, len(names))
		for _, n := range names {
			series[n] = &historySeries{T: []int64{}, V: []float64{}}
		}
		for {
			t, err := stream.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				return echo.NewHTTPError(http.StatusBadGateway, err.Error())
			}
			for k, v := range t.Values {
				s, ok := series[k]
				if !ok {
					continue
				}
				s.T = append(s.T, t.TimestampMs)
				s.V = append(s.V, v)
			}
		}
		return c.JSON(http.StatusOK, historyResponse{Metrics: series})
	}
}

func logsHistoryHandler(client logspb.LogServiceClient) echo.HandlerFunc {
	return func(c echo.Context) error {
		limit := 10000
		if q := c.QueryParam("limit"); q != "" {
			if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 100000 {
				limit = n
			}
		}
		ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
		defer cancel()
		resp, err := client.GetHistory(ctx, &logspb.HistoryRequest{Limit: int32(limit)})
		if err != nil {
			return echo.NewHTTPError(http.StatusBadGateway, err.Error())
		}
		out := make([]wireLog, len(resp.Events))
		for i, ev := range resp.Events {
			out[i] = wireLog{
				ID: ev.Id, T: ev.TimestampMs,
				Level: ev.Level, Source: ev.Source, Message: ev.Message,
			}
		}
		return c.JSON(http.StatusOK, out)
	}
}

// ---------- wire shapes (frozen — frontend depends on these field names) ----------

type wireSample struct {
	T int64              `json:"t"`
	V map[string]float64 `json:"v"`
}

type wireLog struct {
	ID      int64  `json:"id"`
	T       int64  `json:"t"`
	Level   string `json:"level"`
	Source  string `json:"src"`
	Message string `json:"msg"`
}

type historySeries struct {
	T []int64   `json:"t"`
	V []float64 `json:"v"`
}

type historyResponse struct {
	Metrics map[string]*historySeries `json:"metrics"`
}

// Default metrics list — only used when /api/history is called with no
// `metrics=` param. Should match the monolith / metrics service generator.
var MetricsAll = []string{
	"cpu", "memory", "disk", "network",
	"gpu", "requests", "errors",
	"latency_p50", "latency_p99", "queue",
}

// ---------- helpers ----------

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
