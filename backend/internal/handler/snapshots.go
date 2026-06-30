package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/KazukiKandaKK/webgrapgh/backend/internal/hub"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

// --- Validation helpers ---

func validatePathID(c echo.Context, param string) (int64, error) {
	raw := c.Param(param)
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid id")
	}
	return id, nil
}

func validateCreateSnapshotReq(req db.CreateSnapshotRequest) error {
	if strings.TrimSpace(req.Name) == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}
	if utf8.RuneCountInString(req.Name) > 255 {
		return echo.NewHTTPError(http.StatusBadRequest, "name too long")
	}
	if len(req.MetricNames) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "at least one metric required")
	}
	allowed := make(map[string]struct{}, len(db.MetricNames))
	for _, n := range db.MetricNames {
		allowed[n] = struct{}{}
	}
	for _, n := range req.MetricNames {
		if _, ok := allowed[n]; !ok {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid metric name: "+n)
		}
	}
	if req.RangeMinutes < 1 || req.RangeMinutes > 1440 {
		return echo.NewHTTPError(http.StatusBadRequest, "range_minutes must be 1-1440")
	}
	for _, name := range req.MetricNames {
		series, ok := req.SeriesData[name]
		if !ok {
			return echo.NewHTTPError(http.StatusBadRequest, "series_data missing entry for metric: "+name)
		}
		if len(series.T) != len(series.V) {
			return echo.NewHTTPError(http.StatusBadRequest, "t and v arrays must have equal length")
		}
	}
	return nil
}

func validateCreateCommentReq(req *db.CreateCommentRequest) error {
	req.Author = strings.TrimSpace(req.Author)
	if req.Author == "" {
		req.Author = "anonymous"
	}
	if utf8.RuneCountInString(req.Author) > 255 {
		return echo.NewHTTPError(http.StatusBadRequest, "author too long")
	}
	if strings.TrimSpace(req.Body) == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "body is required")
	}
	if utf8.RuneCountInString(req.Body) > 10000 {
		return echo.NewHTTPError(http.StatusBadRequest, "body too long")
	}
	return nil
}

func validatePagination(c echo.Context) (limit, offset int, err error) {
	limit = 50
	offset = 0
	if raw := c.QueryParam("limit"); raw != "" {
		v, e := strconv.Atoi(raw)
		if e != nil || v < 1 || v > 500 {
			return 0, 0, echo.NewHTTPError(http.StatusBadRequest, "limit must be 1-500")
		}
		limit = v
	}
	if raw := c.QueryParam("offset"); raw != "" {
		v, e := strconv.Atoi(raw)
		if e != nil || v < 0 {
			return 0, 0, echo.NewHTTPError(http.StatusBadRequest, "offset must be >= 0")
		}
		offset = v
	}
	return limit, offset, nil
}

// mapSnapshotErr converts a database error to an Echo HTTP error without leaking internals.
func mapSnapshotErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		log.Printf("snapshots: db error code=%s msg=%s", pgErr.Code, pgErr.Message)
	} else {
		log.Printf("snapshots: db error: %v", err)
	}
	return echo.NewHTTPError(http.StatusInternalServerError, "internal error")
}

// --- REST Handlers ---

// CreateSnapshot handles POST /api/snapshots.
func CreateSnapshot(pool *pgxpool.Pool, h *hub.Hub) echo.HandlerFunc {
	return func(c echo.Context) error {
		var req db.CreateSnapshotRequest
		if err := c.Bind(&req); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
		}
		if req.RangeMinutes == 0 {
			req.RangeMinutes = 60
		}
		if err := validateCreateSnapshotReq(req); err != nil {
			return err
		}
		snap, err := db.CreateSnapshot(c.Request().Context(), pool, req)
		if err != nil {
			return mapSnapshotErr(err)
		}
		return c.JSON(http.StatusCreated, snap)
	}
}

// ListSnapshots handles GET /api/snapshots.
func ListSnapshots(pool *pgxpool.Pool) echo.HandlerFunc {
	return func(c echo.Context) error {
		snaps, err := db.ListSnapshots(c.Request().Context(), pool, 100)
		if err != nil {
			return mapSnapshotErr(err)
		}
		if snaps == nil {
			snaps = []db.SnapshotSummary{}
		}
		return c.JSON(http.StatusOK, snaps)
	}
}

// GetSnapshot handles GET /api/snapshots/:id.
func GetSnapshot(pool *pgxpool.Pool) echo.HandlerFunc {
	return func(c echo.Context) error {
		id, err := validatePathID(c, "id")
		if err != nil {
			return err
		}
		snap, err := db.GetSnapshot(c.Request().Context(), pool, id)
		if err != nil {
			return mapSnapshotErr(err)
		}
		if snap == nil {
			return echo.NewHTTPError(http.StatusNotFound, "snapshot not found")
		}
		return c.JSON(http.StatusOK, snap)
	}
}

// DeleteSnapshot handles DELETE /api/snapshots/:id.
func DeleteSnapshot(pool *pgxpool.Pool) echo.HandlerFunc {
	return func(c echo.Context) error {
		id, err := validatePathID(c, "id")
		if err != nil {
			return err
		}
		deleted, err := db.DeleteSnapshot(c.Request().Context(), pool, id)
		if err != nil {
			return mapSnapshotErr(err)
		}
		if !deleted {
			return echo.NewHTTPError(http.StatusNotFound, "snapshot not found")
		}
		return c.NoContent(http.StatusNoContent)
	}
}

// CreateComment handles POST /api/snapshots/:id/comments.
func CreateComment(pool *pgxpool.Pool, h *hub.Hub) echo.HandlerFunc {
	return func(c echo.Context) error {
		snapshotID, err := validatePathID(c, "id")
		if err != nil {
			return err
		}
		snap, err := db.GetSnapshot(c.Request().Context(), pool, snapshotID)
		if err != nil {
			return mapSnapshotErr(err)
		}
		if snap == nil {
			return echo.NewHTTPError(http.StatusNotFound, "snapshot not found")
		}

		var req db.CreateCommentRequest
		if err := c.Bind(&req); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
		}
		if err := validateCreateCommentReq(&req); err != nil {
			return err
		}

		comment, err := db.CreateComment(c.Request().Context(), pool, snapshotID, req.Author, req.Body)
		if err != nil {
			return mapSnapshotErr(err)
		}

		event := db.WSCommentEvent{SnapshotID: snapshotID, Comment: comment}
		if payload, e := json.Marshal(event); e == nil {
			h.Broadcast(payload)
		}

		return c.JSON(http.StatusCreated, comment)
	}
}

// ListComments handles GET /api/snapshots/:id/comments.
func ListComments(pool *pgxpool.Pool) echo.HandlerFunc {
	return func(c echo.Context) error {
		snapshotID, err := validatePathID(c, "id")
		if err != nil {
			return err
		}
		snap, err := db.GetSnapshot(c.Request().Context(), pool, snapshotID)
		if err != nil {
			return mapSnapshotErr(err)
		}
		if snap == nil {
			return echo.NewHTTPError(http.StatusNotFound, "snapshot not found")
		}

		limit, offset, err := validatePagination(c)
		if err != nil {
			return err
		}

		page, err := db.ListComments(c.Request().Context(), pool, snapshotID, limit, offset)
		if err != nil {
			return mapSnapshotErr(err)
		}
		return c.JSON(http.StatusOK, page)
	}
}

// SnapshotWebSocket handles GET /ws/snapshots — fans out WSCommentEvent broadcasts.
func SnapshotWebSocket(h *hub.Hub, allowedOrigins []string) echo.HandlerFunc {
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		originSet[o] = struct{}{}
	}
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return false
			}
			_, ok := originSet[origin]
			return ok
		},
	}

	return func(c echo.Context) error {
		conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
		if err != nil {
			return err
		}
		client := hub.NewClient(sendBuffer)
		if err := h.Register(client); err != nil {
			log.Printf("ws/snapshots: rejecting client: %v", err)
			_ = conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "too many connections"))
			_ = conn.Close()
			return nil
		}
		log.Printf("ws/snapshots: client connected (total=%d)", h.Count())

		go readPump(conn, client, h)
		go writePump(conn, client, h)
		return nil
	}
}
