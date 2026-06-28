package handler

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type HistoryResponse struct {
	Metrics map[string]MetricSeries `json:"metrics"`
}

type MetricSeries struct {
	T []int64   `json:"t"`
	V []float64 `json:"v"`
}

func History(pool *pgxpool.Pool) echo.HandlerFunc {
	allowed := make(map[string]struct{}, len(db.MetricNames))
	for _, n := range db.MetricNames {
		allowed[n] = struct{}{}
	}

	return func(c echo.Context) error {
		names := db.MetricNames
		if q := c.QueryParam("metrics"); q != "" {
			requested := splitCSV(q)
			validated := make([]string, 0, len(requested))
			for _, n := range requested {
				if _, ok := allowed[n]; ok {
					validated = append(validated, n)
				}
			}
			if len(validated) == 0 {
				return echo.NewHTTPError(http.StatusBadRequest, "no valid metric names")
			}
			names = validated
		}
		minutes := 60
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
		maxPoints := 0
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

		raw, err := db.FetchHistory(ctx, pool, names, time.Duration(minutes)*time.Minute, maxPoints)
		if err != nil {
			log.Printf("history: %v", err)
			return echo.NewHTTPError(http.StatusInternalServerError, "internal error")
		}

		resp := HistoryResponse{Metrics: make(map[string]MetricSeries, len(raw))}
		for name, pts := range raw {
			s := MetricSeries{T: make([]int64, len(pts)), V: make([]float64, len(pts))}
			for i, p := range pts {
				s.T[i] = p.TimeMs
				s.V[i] = p.Value
			}
			resp.Metrics[name] = s
		}
		return c.JSON(http.StatusOK, resp)
	}
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
