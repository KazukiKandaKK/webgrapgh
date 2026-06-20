package db

import (
	"context"
	_ "embed"
	"fmt"
	"log"
	"math"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

// MetricNames is the canonical ordered list of dummy metrics produced by the system.
var MetricNames = []string{"cpu", "memory", "network", "disk"}

func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	cfg.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}

func EnsureSchema(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, schemaSQL)
	return err
}

// SeedIfEmpty inserts `perMetric` synthetic points spread evenly across the last
// hour for each metric name, but only when the metrics table is empty.
func SeedIfEmpty(ctx context.Context, pool *pgxpool.Pool, perMetric int) error {
	var count int64
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM metrics`).Scan(&count); err != nil {
		return fmt.Errorf("count: %w", err)
	}
	if count > 0 {
		log.Printf("seed: skipping, %d rows already present", count)
		return nil
	}
	log.Printf("seed: inserting %d points per metric (%d total)…", perMetric, perMetric*len(MetricNames))

	end := time.Now()
	start := end.Add(-time.Hour)
	step := end.Sub(start) / time.Duration(perMetric)

	const batch = 2000
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	for _, name := range MetricNames {
		base, amp, period := metricShape(name)
		rows := make([][]any, 0, batch)
		for i := 0; i < perMetric; i++ {
			t := start.Add(time.Duration(i) * step)
			v := syntheticValue(base, amp, period, t, rng)
			rows = append(rows, []any{t, name, v})
			if len(rows) >= batch {
				if err := copyMetrics(ctx, pool, rows); err != nil {
					return err
				}
				rows = rows[:0]
			}
		}
		if len(rows) > 0 {
			if err := copyMetrics(ctx, pool, rows); err != nil {
				return err
			}
		}
	}
	log.Printf("seed: done")
	return nil
}

func copyMetrics(ctx context.Context, pool *pgxpool.Pool, rows [][]any) error {
	src := newCopyRows(rows)
	_, err := pool.CopyFrom(ctx, []string{"metrics"}, []string{"ts", "metric_name", "value"}, src)
	if err != nil {
		return fmt.Errorf("copy: %w", err)
	}
	return nil
}

type copyRowsSrc struct {
	rows [][]any
	i    int
}

func newCopyRows(rows [][]any) *copyRowsSrc { return &copyRowsSrc{rows: rows, i: -1} }
func (c *copyRowsSrc) Next() bool            { c.i++; return c.i < len(c.rows) }
func (c *copyRowsSrc) Values() ([]any, error) { return c.rows[c.i], nil }
func (c *copyRowsSrc) Err() error             { return nil }

func metricShape(name string) (base, amp, period float64) {
	switch name {
	case "cpu":
		return 45, 25, 180
	case "memory":
		return 62, 8, 600
	case "network":
		return 30, 28, 90
	case "disk":
		return 70, 5, 1200
	}
	return 50, 10, 300
}

func syntheticValue(base, amp, period float64, t time.Time, rng *rand.Rand) float64 {
	x := float64(t.Unix()) / period
	v := base + amp*math.Sin(x*2*math.Pi) + (rng.Float64()-0.5)*amp*0.4
	if v < 0 {
		v = 0
	}
	if v > 100 {
		v = 100
	}
	return v
}

// Point is the wire-friendly representation of a single sample.
type Point struct {
	TimeMs int64   `json:"t"`
	Value  float64 `json:"v"`
}

// FetchHistory returns the last `since` of points for each metric in `names`,
// ordered chronologically.
func FetchHistory(ctx context.Context, pool *pgxpool.Pool, names []string, since time.Duration) (map[string][]Point, error) {
	out := make(map[string][]Point, len(names))
	cutoff := time.Now().Add(-since)
	for _, n := range names {
		rows, err := pool.Query(ctx,
			`SELECT ts, value FROM metrics WHERE metric_name = $1 AND ts >= $2 ORDER BY ts ASC`,
			n, cutoff,
		)
		if err != nil {
			return nil, err
		}
		pts := make([]Point, 0, 4096)
		for rows.Next() {
			var ts time.Time
			var v float64
			if err := rows.Scan(&ts, &v); err != nil {
				rows.Close()
				return nil, err
			}
			pts = append(pts, Point{TimeMs: ts.UnixMilli(), Value: v})
		}
		rows.Close()
		out[n] = pts
	}
	return out, nil
}

// InsertSample writes a single live sample. The hot path tolerates DB errors
// quietly so that broadcasting is never blocked by storage.
func InsertSample(ctx context.Context, pool *pgxpool.Pool, ts time.Time, name string, value float64) {
	_, err := pool.Exec(ctx,
		`INSERT INTO metrics (ts, metric_name, value) VALUES ($1, $2, $3)`,
		ts, name, value,
	)
	if err != nil {
		log.Printf("insert sample %s: %v", name, err)
	}
}
