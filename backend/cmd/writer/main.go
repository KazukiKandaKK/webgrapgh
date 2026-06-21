// Command writer is the producer side of the DB-driven pipeline. It generates
// synthetic samples for every known metric at PUSH_HZ ticks per second,
// inserts them in a single batch (one row per metric, all sharing the tick's
// timestamp), and issues `NOTIFY metrics_new` to wake the server's watcher.
//
// The writer talks to PostgreSQL only — it never opens a WebSocket and is
// completely decoupled from the HTTP server. Multiple writer instances can
// run side-by-side; the watcher will see every row.
package main

import (
	"context"
	"fmt"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/config"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/metrics"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/watcher"
	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
)

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
		log.Fatalf("writer: db connect: %v", err)
	}
	defer pool.Close()
	if err := db.EnsureSchema(ctx, pool); err != nil {
		log.Fatalf("writer: schema: %v", err)
	}

	hz := cfg.PushHz
	if hz < 1 {
		hz = 1
	}
	interval := time.Second / time.Duration(hz)
	tick := time.NewTicker(interval)
	defer tick.Stop()

	gen := metrics.NewGenerator()
	notifyStmt := fmt.Sprintf("SELECT pg_notify('%s', '')", watcher.Channel)

	log.Printf("writer: started, %d metrics @ %dHz (notify=%s)",
		len(db.MetricNames), hz, watcher.Channel)

	var inserted uint64
	logTick := time.NewTicker(10 * time.Second)
	defer logTick.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("writer: shutting down, %d rows inserted", inserted)
			return
		case <-logTick.C:
			log.Printf("writer: %d rows inserted so far", inserted)
		case now := <-tick.C:
			s := gen.Next(now, db.MetricNames)
			batch := &pgx.Batch{}
			for name, v := range s.Values {
				batch.Queue(
					`INSERT INTO metrics (ts, metric_name, value) VALUES ($1, $2, $3)`,
					now, name, v,
				)
			}
			// One NOTIFY per tick wakes the watcher once per batch, which
			// then drains all rows in that tick. Much cheaper than NOTIFY
			// per-row.
			batch.Queue(notifyStmt)

			br := pool.SendBatch(ctx, batch)
			if err := br.Close(); err != nil {
				log.Printf("writer: batch: %v", err)
				continue
			}
			inserted += uint64(len(db.MetricNames))
		}
	}
}
