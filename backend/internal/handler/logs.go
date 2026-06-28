package handler

import (
	"fmt"
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
			n, err := strconv.Atoi(q)
			if err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, "limit: invalid integer")
			}
			if n < 1 || n > store.Capacity() {
				return echo.NewHTTPError(http.StatusBadRequest,
					fmt.Sprintf("limit: must be between 1 and %d", store.Capacity()))
			}
			limit = n
		}
		return c.JSON(http.StatusOK, store.Snapshot(limit))
	}
}
