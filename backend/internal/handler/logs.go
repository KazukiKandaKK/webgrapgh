package handler

import (
	"net/http"
	"strconv"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/logs"
	"github.com/labstack/echo/v4"
)

// LogsHistory returns the most recent `limit` log events (chronological order).
// Defaults to 10_000, capped at the store's capacity.
func LogsHistory(store *logs.Store) echo.HandlerFunc {
	return func(c echo.Context) error {
		limit := 10000
		if q := c.QueryParam("limit"); q != "" {
			if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= store.Capacity() {
				limit = n
			}
		}
		return c.JSON(http.StatusOK, store.Snapshot(limit))
	}
}
