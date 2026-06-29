package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// FetchContainerHistory returns the last `since` of points for every
// (container, metric) pair, ordered chronologically and grouped as
// container -> metric -> points. When `maxPoints > 0`, each series is
// stride-downsampled in-process to cap the JSON payload.
func FetchContainerHistory(
	ctx context.Context, pool *pgxpool.Pool, since time.Duration, maxPoints int,
) (map[string]map[string][]Point, error) {
	cutoff := time.Now().Add(-since)
	rows, err := pool.Query(ctx,
		`SELECT container, metric, ts, value
		   FROM container_metrics
		  WHERE ts >= $1
		  ORDER BY container, metric, ts ASC`,
		cutoff,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]map[string][]Point)
	for rows.Next() {
		var container, metric string
		var ts time.Time
		var v float64
		if err := rows.Scan(&container, &metric, &ts, &v); err != nil {
			return nil, err
		}
		byMetric, ok := out[container]
		if !ok {
			byMetric = make(map[string][]Point)
			out[container] = byMetric
		}
		byMetric[metric] = append(byMetric[metric], Point{TimeMs: ts.UnixMilli(), Value: v})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if maxPoints > 0 {
		for _, byMetric := range out {
			for m, pts := range byMetric {
				byMetric[m] = downsample(pts, maxPoints)
			}
		}
	}
	return out, nil
}

// downsample stride-reduces pts to at most maxPoints, always keeping the last.
func downsample(pts []Point, maxPoints int) []Point {
	if maxPoints <= 0 || len(pts) <= maxPoints {
		return pts
	}
	stride := (len(pts) + maxPoints - 1) / maxPoints
	if stride < 1 {
		stride = 1
	}
	out := make([]Point, 0, maxPoints+1)
	for i := 0; i < len(pts); i += stride {
		out = append(out, pts[i])
	}
	if last := pts[len(pts)-1]; len(out) == 0 || out[len(out)-1].TimeMs != last.TimeMs {
		out = append(out, last)
	}
	return out
}
