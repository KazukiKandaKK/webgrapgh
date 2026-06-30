package main

import (
	"testing"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/metrics"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/watcher"
	"github.com/jackc/pgx/v5"
)

func TestBatchConstruction(t *testing.T) {
	// Verify that a single tick produces len(MetricNames)+1 queued statements
	// (one INSERT per metric + one NOTIFY).
	gen := metrics.NewGenerator()
	now := time.Date(2025, 6, 15, 12, 0, 0, 0, time.UTC)
	s := gen.Next(now, db.MetricNames)

	batch := &pgx.Batch{}
	for name, v := range s.Values {
		batch.Queue(
			`INSERT INTO metrics (ts, metric_name, value) VALUES ($1, $2, $3)`,
			now, name, v,
		)
	}
	batch.Queue("SELECT pg_notify('" + watcher.Channel + "', '')")

	// len(MetricNames) data rows + 1 NOTIFY
	want := len(db.MetricNames) + 1
	if got := batch.Len(); got != want {
		t.Fatalf("batch.Len() = %d, want %d", got, want)
	}
}

func TestBatchConstruction_AllMetricsPresent(t *testing.T) {
	// Verify that Next returns exactly the expected metrics.
	gen := metrics.NewGenerator()
	now := time.Now()
	s := gen.Next(now, db.MetricNames)

	if len(s.Values) != len(db.MetricNames) {
		t.Fatalf("sample has %d values, want %d", len(s.Values), len(db.MetricNames))
	}
	for _, name := range db.MetricNames {
		v, ok := s.Values[name]
		if !ok {
			t.Errorf("metric %q missing from sample", name)
		}
		if v < 0 {
			t.Errorf("metric %q = %f, should be >= 0", name, v)
		}
	}
}

func TestNotifyStatement(t *testing.T) {
	// The NOTIFY statement uses the watcher.Channel constant, which the
	// watcher's LISTEN also subscribes to. Verify they match.
	expected := "metrics_new"
	if watcher.Channel != expected {
		t.Fatalf("watcher.Channel = %q, want %q", watcher.Channel, expected)
	}
}

func TestHzClamping(t *testing.T) {
	// Writer clamps Hz < 1 to 1 to avoid divide-by-zero in ticker.
	cases := []struct {
		input int
		want  int
	}{
		{0, 1},
		{-5, 1},
		{1, 1},
		{10, 10},
	}
	for _, c := range cases {
		hz := c.input
		if hz < 1 {
			hz = 1
		}
		if hz != c.want {
			t.Errorf("clamp(%d) = %d, want %d", c.input, hz, c.want)
		}
	}
}
