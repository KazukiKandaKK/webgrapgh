// Command seed bulk-loads synthetic time-series data into the metrics table.
//
//	seed --hours 24 --hz 100 --reset
//	# 24h × 3600s × 100Hz × 4 metrics ≈ 34.5M rows
//
// All flags are optional. Connection details come from the same env vars as
// the server (POSTGRES_*).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/config"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load(".env")
	_ = godotenv.Load("../.env")
	_ = godotenv.Load("../../.env")

	var (
		hours      = flag.Float64("hours", 1, "lookback window in hours (samples are spread evenly across [now-hours, now])")
		hz         = flag.Float64("hz", 0, "samples per second per metric (overrides --points-per-metric when > 0)")
		perMetric  = flag.Int("points-per-metric", 20000, "explicit point count per metric (ignored when --hz > 0)")
		batch      = flag.Int("batch", 10000, "COPY batch size")
		reset      = flag.Bool("reset", false, "TRUNCATE the metrics table before loading")
		metricsCSV = flag.String("metrics", "", "comma-separated metric names (default: cpu,memory,network,disk)")
		quiet      = flag.Bool("quiet", false, "suppress per-batch progress lines")
	)
	flag.Parse()

	if *hours <= 0 {
		log.Fatalf("--hours must be > 0")
	}

	// Resolve the metric list.
	names := db.MetricNames
	if *metricsCSV != "" {
		names = splitCSV(*metricsCSV)
	}
	if len(names) == 0 {
		log.Fatalf("no metric names")
	}

	// Resolve PerMetric: --hz wins if provided.
	totalPerMetric := *perMetric
	if *hz > 0 {
		totalPerMetric = int(*hours * 3600 * *hz)
	}
	if totalPerMetric <= 0 {
		log.Fatalf("computed point count is 0 (check --hours / --hz)")
	}

	cfg := config.Load()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.PostgresDSN())
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	if err := db.EnsureSchema(ctx, pool); err != nil {
		log.Fatalf("schema: %v", err)
	}

	end := time.Now()
	start := end.Add(-time.Duration(*hours * float64(time.Hour)))

	totalRows := totalPerMetric * len(names)
	log.Printf("seed: target = %d points/metric × %d metrics = %s rows",
		totalPerMetric, len(names), commas(int64(totalRows)))
	log.Printf("seed: range  = %s → %s", start.Format(time.RFC3339), end.Format(time.RFC3339))
	if *reset {
		log.Printf("seed: --reset set, table will be TRUNCATEd first")
	}

	began := time.Now()
	lastLog := time.Now()
	progress := func(name string, written, total int) {
		if *quiet {
			return
		}
		// Throttle to ~1 line / 500ms so massive loads don't flood stderr.
		if time.Since(lastLog) < 500*time.Millisecond && written != total {
			return
		}
		lastLog = time.Now()
		pct := float64(written) * 100 / float64(total)
		log.Printf("  %-8s %s / %s  (%5.1f%%)", name, commas(int64(written)), commas(int64(total)), pct)
	}

	inserted, err := db.Bulk(ctx, pool, db.BulkOptions{
		Names:      names,
		Start:      start,
		End:        end,
		PerMetric:  totalPerMetric,
		Batch:      *batch,
		Reset:      *reset,
		OnProgress: progress,
	})
	if err != nil {
		log.Fatalf("bulk: %v (inserted %s rows before failure)", err, commas(inserted))
	}

	elapsed := time.Since(began)
	rate := float64(inserted) / elapsed.Seconds()
	log.Printf("seed: done — %s rows in %s (%.0f rows/s)", commas(inserted), elapsed.Round(time.Millisecond), rate)
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

// commas formats n with thousands separators (no fmt locale dependency).
func commas(n int64) string {
	s := fmt.Sprintf("%d", n)
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}
