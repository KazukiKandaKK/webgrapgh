package watcher

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ContainerChannel is the PostgreSQL NOTIFY channel cmd/collector signals after
// inserting a batch of container_metrics rows.
const ContainerChannel = "container_metrics_new"

// containerRow is one (container, metric, value) datum on the wire.
type containerRow struct {
	Container string  `json:"c"`
	Metric    string  `json:"m"`
	Value     float64 `json:"v"`
}

// containerFrame groups every row sharing a timestamp into a single WS message.
type containerFrame struct {
	TimeMs int64          `json:"t"`
	Rows   []containerRow `json:"rows"`
}

// RunContainers mirrors Run but for the container_metrics table / channel. It
// LISTENs for collector NOTIFYs, drains new rows, groups them by timestamp, and
// broadcasts one frame per timestamp to the container WS hub.
func RunContainers(ctx context.Context, pool *pgxpool.Pool, h Broadcaster) {
	var lastID int64
	if err := initLastID(ctx, pool, `SELECT COALESCE(MAX(id), 0) FROM container_metrics`, &lastID); err != nil {
		log.Printf("container watcher: init lastID failed, will retry: %v", err)
	}
	log.Printf("container watcher: started, LISTEN %s, lastID=%d", ContainerChannel, lastID)

	backoff := time.Second
	for {
		err := containerLoop(ctx, pool, h, &lastID)
		if ctx.Err() != nil {
			return
		}
		log.Printf("container watcher: loop ended (%v); reconnecting in %s", err, backoff)
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

func containerLoop(ctx context.Context, pool *pgxpool.Pool, h Broadcaster, lastID *int64) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN "+ContainerChannel); err != nil {
		return fmt.Errorf("LISTEN: %w", err)
	}
	if err := drainContainers(ctx, pool, h, lastID); err != nil {
		return fmt.Errorf("initial drain: %w", err)
	}
	for {
		if _, err := conn.Conn().WaitForNotification(ctx); err != nil {
			return fmt.Errorf("WaitForNotification: %w", err)
		}
		if err := drainContainers(ctx, pool, h, lastID); err != nil {
			return fmt.Errorf("drain: %w", err)
		}
	}
}

func drainContainers(ctx context.Context, pool *pgxpool.Pool, h Broadcaster, lastID *int64) error {
	rows, err := pool.Query(ctx,
		`SELECT id, ts, container, metric, value
		   FROM container_metrics
		  WHERE id > $1
		  ORDER BY id ASC
		  LIMIT 5000`,
		*lastID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	byTs := make(map[int64]*containerFrame, 16)
	ordered := make([]*containerFrame, 0, 16)
	maxID := *lastID

	for rows.Next() {
		var id int64
		var ts time.Time
		var container, metric string
		var v float64
		if err := rows.Scan(&id, &ts, &container, &metric, &v); err != nil {
			return err
		}
		if id > maxID {
			maxID = id
		}
		key := ts.UnixNano()
		f, ok := byTs[key]
		if !ok {
			f = &containerFrame{TimeMs: ts.UnixMilli()}
			byTs[key] = f
			ordered = append(ordered, f)
		}
		f.Rows = append(f.Rows, containerRow{Container: container, Metric: metric, Value: v})
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, f := range ordered {
		payload, err := json.Marshal(f)
		if err != nil {
			log.Printf("container watcher: marshal frame: %v", err)
			continue
		}
		h.Broadcast(payload)
	}
	*lastID = maxID
	return nil
}
