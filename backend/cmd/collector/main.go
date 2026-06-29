// Command collector is the container-metrics producer. It auto-discovers every
// running container via the Docker Engine API, derives Datadog-style gauges
// (CPU%, memory, network throughput), inserts them into the container_metrics
// table, and issues `NOTIFY container_metrics_new` to wake the server's
// container watcher.
//
// Like cmd/writer it talks only to PostgreSQL + the Docker socket; it never
// opens a WebSocket and is fully decoupled from the HTTP server.
package main

import (
	"context"
	"fmt"
	"log"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/config"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/dockerstats"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/watcher"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// prevNet remembers the last cumulative network counters per container so the
// collector can derive per-second throughput rates.
type prevNet struct {
	rx, tx float64
	at     time.Time
}

func main() {
	_ = godotenv.Load(".env")
	_ = godotenv.Load("../.env")
	_ = godotenv.Load("../../.env")

	cfg := config.Load()

	ctx, cancel := signal.NotifyContext(
		context.Background(), syscall.SIGINT, syscall.SIGTERM,
	)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.PostgresDSN())
	if err != nil {
		log.Fatalf("collector: db connect: %v", err)
	}
	defer pool.Close()
	if err := db.EnsureSchema(ctx, pool); err != nil {
		log.Fatalf("collector: schema: %v", err)
	}

	client, err := dockerstats.New(cfg.DockerHost)
	if err != nil {
		log.Fatalf("collector: docker client: %v", err)
	}

	hz := cfg.CollectHz
	if hz < 1 {
		hz = 1
	}
	interval := time.Second / time.Duration(hz)
	tick := time.NewTicker(interval)
	defer tick.Stop()

	notifyStmt := fmt.Sprintf("SELECT pg_notify('%s', '')", watcher.ContainerChannel)
	prev := make(map[string]prevNet)

	log.Printf("collector: started, docker=%s @ %dHz (notify=%s)",
		cfg.DockerHost, hz, watcher.ContainerChannel)

	for {
		select {
		case <-ctx.Done():
			log.Printf("collector: shutting down")
			return
		case now := <-tick.C:
			if err := collectOnce(ctx, client, pool, notifyStmt, prev, now); err != nil {
				log.Printf("collector: cycle: %v", err)
			}
		}
	}
}

func collectOnce(
	ctx context.Context,
	client *dockerstats.Client,
	pool *pgxpool.Pool,
	notifyStmt string,
	prev map[string]prevNet,
	now time.Time,
) error {
	listCtx, cancel := dockerstats.WithTimeout(ctx)
	defer cancel()
	containers, err := client.List(listCtx)
	if err != nil {
		return fmt.Errorf("list: %w", err)
	}

	type result struct {
		name   string
		id     string
		sample dockerstats.Sample
	}

	results := make([]result, len(containers))
	var wg sync.WaitGroup
	for i, ct := range containers {
		wg.Add(1)
		go func(i int, ct dockerstats.Container) {
			defer wg.Done()
			sCtx, sCancel := dockerstats.WithTimeout(ctx)
			defer sCancel()
			st, err := client.Stats(sCtx, ct.ID)
			if err != nil {
				log.Printf("collector: stats %s: %v", ct.Name(), err)
				return
			}
			results[i] = result{name: ct.Name(), id: ct.ID, sample: dockerstats.Compute(st)}
		}(i, ct)
	}
	wg.Wait()

	batch := &pgx.Batch{}
	rows := 0
	seen := make(map[string]struct{}, len(results))
	for _, r := range results {
		if r.name == "" { // failed fetch
			continue
		}
		seen[r.id] = struct{}{}
		s := r.sample

		// Derive network throughput from the previous cumulative counters.
		var rxBps, txBps float64
		if p, ok := prev[r.id]; ok {
			dt := now.Sub(p.at).Seconds()
			rxBps = dockerstats.Rate(p.rx, s.NetRxBytes, dt)
			txBps = dockerstats.Rate(p.tx, s.NetTxBytes, dt)
		}
		prev[r.id] = prevNet{rx: s.NetRxBytes, tx: s.NetTxBytes, at: now}

		emit := map[string]float64{
			dockerstats.MetricCPUPercent: s.CPUPercent,
			dockerstats.MetricMemBytes:   s.MemBytes,
			dockerstats.MetricMemPercent: s.MemPercent,
			dockerstats.MetricNetRxBps:   rxBps,
			dockerstats.MetricNetTxBps:   txBps,
		}
		for metric, v := range emit {
			batch.Queue(
				`INSERT INTO container_metrics (ts, container, metric, value) VALUES ($1, $2, $3, $4)`,
				now, r.name, metric, v,
			)
			rows++
		}
	}

	// Drop bookkeeping for containers that disappeared so the map can't grow
	// unbounded across restarts.
	for id := range prev {
		if _, ok := seen[id]; !ok {
			delete(prev, id)
		}
	}

	if rows == 0 {
		return nil
	}
	batch.Queue(notifyStmt)
	br := pool.SendBatch(ctx, batch)
	if err := br.Close(); err != nil {
		return fmt.Errorf("batch: %w", err)
	}
	return nil
}
