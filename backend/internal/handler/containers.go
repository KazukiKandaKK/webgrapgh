package handler

import (
	"context"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type ContainersHistoryResponse struct {
	// Containers is the sorted set of container names present in the window.
	Containers []string `json:"containers"`
	// Series maps container -> metric -> points.
	Series map[string]map[string]MetricSeries `json:"series"`
}

// ContainersHistory serves recent per-container metric history to bootstrap the
// Containers screen (the live tail then arrives via /ws/containers).
func ContainersHistory(pool *pgxpool.Pool) echo.HandlerFunc {
	return func(c echo.Context) error {
		minutes := 15
		if q := c.QueryParam("minutes"); q != "" {
			n, err := strconv.Atoi(q)
			if err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, "minutes: invalid integer")
			}
			if n < 1 || n > 24*60 {
				return echo.NewHTTPError(http.StatusBadRequest, "minutes: must be between 1 and 1440")
			}
			minutes = n
		}
		maxPoints := 240
		if q := c.QueryParam("max_points"); q != "" {
			n, err := strconv.Atoi(q)
			if err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, "max_points: invalid integer")
			}
			if n < 1 || n > 100_000 {
				return echo.NewHTTPError(http.StatusBadRequest, "max_points: must be between 1 and 100000")
			}
			maxPoints = n
		}

		ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
		defer cancel()

		raw, err := db.FetchContainerHistory(ctx, pool, time.Duration(minutes)*time.Minute, maxPoints)
		if err != nil {
			log.Printf("containers history: %v", err)
			return echo.NewHTTPError(http.StatusInternalServerError, "internal error")
		}

		resp := ContainersHistoryResponse{
			Containers: make([]string, 0, len(raw)),
			Series:     make(map[string]map[string]MetricSeries, len(raw)),
		}
		for container, byMetric := range raw {
			resp.Containers = append(resp.Containers, container)
			series := make(map[string]MetricSeries, len(byMetric))
			for metric, pts := range byMetric {
				s := MetricSeries{T: make([]int64, len(pts)), V: make([]float64, len(pts))}
				for i, p := range pts {
					s.T[i] = p.TimeMs
					s.V[i] = p.Value
				}
				series[metric] = s
			}
			resp.Series[container] = series
		}
		sort.Strings(resp.Containers)
		return c.JSON(http.StatusOK, resp)
	}
}
