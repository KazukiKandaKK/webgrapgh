package db

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// retentionTables is the fixed set of tables subject to TTL cleanup.
// Only tables listed here can be passed to deleteOlder, preventing
// dynamic table names from being used as an injection vector.
var retentionTables = map[string]struct{}{
	"metrics":           {},
	"container_metrics": {},
	"snapshots":         {},
}

// DefaultRetention is the maximum age of data kept in metrics/container_metrics.
const DefaultRetention = 24 * time.Hour

// DefaultSnapshotRetention is the maximum age of snapshots. Snapshots are
// user-created and less voluminous, so they are kept longer than raw metrics.
const DefaultSnapshotRetention = 30 * 24 * time.Hour

// MaxSnapshots is the hard cap on the number of stored snapshots.
// When exceeded, the oldest snapshots beyond this count are deleted.
const MaxSnapshots = 500

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
			pruneSnapshots(ctx, pool)
		}
	}
}

// pruneSnapshots enforces two limits on the snapshots table:
//  1. Delete snapshots older than DefaultSnapshotRetention.
//  2. If more than MaxSnapshots remain, delete the oldest ones beyond the cap.
//
// Comments are cleaned up automatically via ON DELETE CASCADE.
func pruneSnapshots(ctx context.Context, pool *pgxpool.Pool) {
	cutoff := time.Now().Add(-DefaultSnapshotRetention)
	tag, err := pool.Exec(ctx,
		`DELETE FROM snapshots WHERE created_at < $1`, cutoff)
	if err != nil {
		log.Printf("retention(snapshots/ttl): %v", err)
	} else if tag.RowsAffected() > 0 {
		log.Printf("retention(snapshots/ttl): deleted %d snapshots older than %s",
			tag.RowsAffected(), cutoff.Format(time.RFC3339))
	}

	tag, err = pool.Exec(ctx,
		`DELETE FROM snapshots WHERE id NOT IN (
			SELECT id FROM snapshots ORDER BY created_at DESC LIMIT $1
		)`, MaxSnapshots)
	if err != nil {
		log.Printf("retention(snapshots/cap): %v", err)
	} else if tag.RowsAffected() > 0 {
		log.Printf("retention(snapshots/cap): deleted %d snapshots exceeding cap %d",
			tag.RowsAffected(), MaxSnapshots)
	}
}

func deleteOlder(ctx context.Context, pool *pgxpool.Pool, table string, cutoff time.Time) {
	if _, ok := retentionTables[table]; !ok {
		log.Printf("retention: refusing unknown table %q", table)
		return
	}
	query := fmt.Sprintf(`DELETE FROM %s WHERE ts < $1`, table)
	tag, err := pool.Exec(ctx, query, cutoff)
	if err != nil {
		log.Printf("retention(%s): %v", table, err)
		return
	}
	if tag.RowsAffected() > 0 {
		log.Printf("retention(%s): deleted %d rows older than %s",
			table, tag.RowsAffected(), cutoff.Format(time.RFC3339))
	}
}
