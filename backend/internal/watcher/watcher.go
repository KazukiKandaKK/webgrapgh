// Package watcher subscribes to PostgreSQL NOTIFY events on the `metrics_new`
// channel and broadcasts every new row to the WebSocket hub. It is the
// consumer side of a decoupled producer/consumer pipeline:
//
//	cmd/writer        →  INSERT … ; NOTIFY metrics_new
//	internal/watcher  →  LISTEN metrics_new → fetch new rows → hub.Broadcast
//
// The watcher tracks `lastID` per process. On startup it seeds it from
// MAX(id), so historical rows are NOT re-emitted; only rows inserted after
// the watcher starts are streamed. (Historical data is served via the
// /api/history REST endpoint instead.)
package watcher

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/metrics"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Channel is the PostgreSQL NOTIFY channel name. Writers must
// `SELECT pg_notify(<Channel>, ...)` after each insert batch.
const Channel = "metrics_new"

// Broadcaster is the minimal hub surface the watcher needs.
type Broadcaster interface {
	Broadcast(payload []byte)
}

// Run blocks until ctx is cancelled. It transparently reconnects on
// connection failure with exponential backoff capped at 10s.
func Run(ctx context.Context, pool *pgxpool.Pool, h Broadcaster) {
	var lastID int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(MAX(id), 0) FROM metrics`).Scan(&lastID); err != nil {
		log.Fatalf("watcher: init lastID: %v", err)
	}
	log.Printf("watcher: started, LISTEN %s, lastID=%d", Channel, lastID)

	backoff := time.Second
	for {
		err := loop(ctx, pool, h, &lastID)
		if ctx.Err() != nil {
			return
		}
		log.Printf("watcher: loop ended (%v); reconnecting in %s", err, backoff)
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

func loop(ctx context.Context, pool *pgxpool.Pool, h Broadcaster, lastID *int64) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN "+Channel); err != nil {
		return fmt.Errorf("LISTEN: %w", err)
	}

	// Drain anything that landed between (MAX(id) at init) and (LISTEN
	// becoming effective). Without this, rows inserted in that tiny window
	// would be invisible until the next NOTIFY.
	if err := drain(ctx, pool, h, lastID); err != nil {
		return fmt.Errorf("initial drain: %w", err)
	}

	for {
		if _, err := conn.Conn().WaitForNotification(ctx); err != nil {
			return fmt.Errorf("WaitForNotification: %w", err)
		}
		if err := drain(ctx, pool, h, lastID); err != nil {
			return fmt.Errorf("drain: %w", err)
		}
	}
}

// drain reads every row with id > *lastID, groups them by timestamp into one
// Sample per timestamp, broadcasts each Sample, and advances *lastID.
func drain(ctx context.Context, pool *pgxpool.Pool, h Broadcaster, lastID *int64) error {
	rows, err := pool.Query(ctx,
		`SELECT id, ts, metric_name, value
		   FROM metrics
		  WHERE id > $1
		  ORDER BY id ASC
		  LIMIT 5000`,
		*lastID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	type group struct {
		ts  time.Time
		s   metrics.Sample
	}
	byTs := make(map[int64]*group, 16)
	ordered := make([]*group, 0, 16)
	maxID := *lastID

	for rows.Next() {
		var id int64
		var ts time.Time
		var name string
		var v float64
		if err := rows.Scan(&id, &ts, &name, &v); err != nil {
			return err
		}
		if id > maxID {
			maxID = id
		}
		key := ts.UnixNano()
		g, ok := byTs[key]
		if !ok {
			g = &group{
				ts: ts,
				s:  metrics.Sample{TimeMs: ts.UnixMilli(), Values: map[string]float64{}},
			}
			byTs[key] = g
			ordered = append(ordered, g)
		}
		g.s.Values[name] = v
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, g := range ordered {
		payload, err := json.Marshal(g.s)
		if err != nil {
			log.Printf("watcher: marshal sample: %v", err)
			continue
		}
		h.Broadcast(payload)
	}
	*lastID = maxID
	return nil
}
