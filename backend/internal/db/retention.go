package db

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultRetention is the maximum age of data kept in metrics/container_metrics.
const DefaultRetention = 24 * time.Hour

// RunRetention periodically deletes rows older than `retention` from both
// metrics tables. This bounds disk growth when the system runs indefinitely.
// It blocks until ctx is cancelled.
func RunRetention(ctx context.Context, pool *pgxpool.Pool, retention time.Duration) {
	if retention <= 0 {
		retention = DefaultRetention
	}
	// Run cleanup every 10 minutes (or retention/6 if retention is very short).
	interval := retention / 6
	if interval < time.Minute {
		interval = time.Minute
	}
	if interval > 10*time.Minute {
		interval = 10 * time.Minute
	}

	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			cutoff := time.Now().Add(-retention)
			deleteOlder(ctx, pool, "metrics", cutoff)
			deleteOlder(ctx, pool, "container_metrics", cutoff)
		}
	}
}

func deleteOlder(ctx context.Context, pool *pgxpool.Pool, table string, cutoff time.Time) {
	tag, err := pool.Exec(ctx,
		`DELETE FROM `+table+` WHERE ts < $1`, cutoff)
	if err != nil {
		log.Printf("retention(%s): %v", table, err)
		return
	}
	if tag.RowsAffected() > 0 {
		log.Printf("retention(%s): deleted %d rows older than %s",
			table, tag.RowsAffected(), cutoff.Format(time.RFC3339))
	}
}
