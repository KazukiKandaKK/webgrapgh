package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/db"
	"github.com/labstack/echo/v4"
)

// newEchoCtx creates an Echo context with the given method, path, and body.
func newEchoCtx(method, path, body string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	return e.NewContext(req, rec), rec
}

// --- validatePathID ---

func TestValidatePathID_Valid(t *testing.T) {
	c, _ := newEchoCtx(http.MethodGet, "/", "")
	c.SetParamNames("id")
	c.SetParamValues("42")
	id, err := validatePathID(c, "id")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if id != 42 {
		t.Fatalf("expected 42, got %d", id)
	}
}

func TestValidatePathID_Zero(t *testing.T) {
	c, _ := newEchoCtx(http.MethodGet, "/", "")
	c.SetParamNames("id")
	c.SetParamValues("0")
	_, err := validatePathID(c, "id")
	if err == nil {
		t.Fatal("expected error for id=0")
	}
}

func TestValidatePathID_Negative(t *testing.T) {
	c, _ := newEchoCtx(http.MethodGet, "/", "")
	c.SetParamNames("id")
	c.SetParamValues("-1")
	_, err := validatePathID(c, "id")
	if err == nil {
		t.Fatal("expected error for id=-1")
	}
}

func TestValidatePathID_NonNumeric(t *testing.T) {
	c, _ := newEchoCtx(http.MethodGet, "/", "")
	c.SetParamNames("id")
	c.SetParamValues("abc")
	_, err := validatePathID(c, "id")
	if err == nil {
		t.Fatal("expected error for non-numeric id")
	}
}

// --- validateCreateSnapshotReq ---

func TestValidateCreateSnapshotReq_EmptyName(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:         "",
		MetricNames:  []string{"cpu"},
		SeriesData:   map[string]db.MetricSeries{"cpu": {T: []int64{1}, V: []float64{1.0}}},
		RangeMinutes: 60,
	}
	if err := validateCreateSnapshotReq(req); err == nil {
		t.Fatal("expected error for empty name")
	}
}

func TestValidateCreateSnapshotReq_WhitespaceName(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:         "   ",
		MetricNames:  []string{"cpu"},
		SeriesData:   map[string]db.MetricSeries{"cpu": {T: []int64{1}, V: []float64{1.0}}},
		RangeMinutes: 60,
	}
	if err := validateCreateSnapshotReq(req); err == nil {
		t.Fatal("expected error for whitespace-only name")
	}
}

func TestValidateCreateSnapshotReq_EmptyMetrics(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:         "test",
		MetricNames:  []string{},
		SeriesData:   map[string]db.MetricSeries{},
		RangeMinutes: 60,
	}
	if err := validateCreateSnapshotReq(req); err == nil {
		t.Fatal("expected error for empty metric_names")
	}
}

func TestValidateCreateSnapshotReq_InvalidMetricName(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:         "test",
		MetricNames:  []string{"not_a_real_metric"},
		SeriesData:   map[string]db.MetricSeries{"not_a_real_metric": {}},
		RangeMinutes: 60,
	}
	if err := validateCreateSnapshotReq(req); err == nil {
		t.Fatal("expected error for invalid metric name")
	}
}

func TestValidateCreateSnapshotReq_RangeMinutesTooLow(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:         "test",
		MetricNames:  []string{"cpu"},
		SeriesData:   map[string]db.MetricSeries{"cpu": {T: []int64{1}, V: []float64{1.0}}},
		RangeMinutes: 0,
	}
	if err := validateCreateSnapshotReq(req); err == nil {
		t.Fatal("expected error for range_minutes=0")
	}
}

func TestValidateCreateSnapshotReq_RangeMinutesTooHigh(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:         "test",
		MetricNames:  []string{"cpu"},
		SeriesData:   map[string]db.MetricSeries{"cpu": {T: []int64{1}, V: []float64{1.0}}},
		RangeMinutes: 1441,
	}
	if err := validateCreateSnapshotReq(req); err == nil {
		t.Fatal("expected error for range_minutes=1441")
	}
}

func TestValidateCreateSnapshotReq_MissingSeriesData(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:         "test",
		MetricNames:  []string{"cpu", "memory"},
		SeriesData:   map[string]db.MetricSeries{"cpu": {T: []int64{1}, V: []float64{1.0}}},
		RangeMinutes: 60,
	}
	if err := validateCreateSnapshotReq(req); err == nil {
		t.Fatal("expected error for missing series_data entry")
	}
}

func TestValidateCreateSnapshotReq_UnequalTVLength(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:        "test",
		MetricNames: []string{"cpu"},
		SeriesData: map[string]db.MetricSeries{
			"cpu": {T: []int64{1, 2}, V: []float64{1.0}},
		},
		RangeMinutes: 60,
	}
	if err := validateCreateSnapshotReq(req); err == nil {
		t.Fatal("expected error for unequal t/v array lengths")
	}
}

func TestValidateCreateSnapshotReq_Valid(t *testing.T) {
	req := db.CreateSnapshotRequest{
		Name:        "valid snapshot",
		MetricNames: []string{"cpu"},
		SeriesData: map[string]db.MetricSeries{
			"cpu": {T: []int64{1000, 2000}, V: []float64{50.0, 60.0}},
		},
		RangeMinutes: 60,
	}
	if err := validateCreateSnapshotReq(req); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

// --- validateCreateCommentReq ---

func TestValidateCreateCommentReq_EmptyBody(t *testing.T) {
	req := &db.CreateCommentRequest{Author: "alice", Body: ""}
	if err := validateCreateCommentReq(req); err == nil {
		t.Fatal("expected error for empty body")
	}
}

func TestValidateCreateCommentReq_WhitespaceBody(t *testing.T) {
	req := &db.CreateCommentRequest{Author: "alice", Body: "   "}
	if err := validateCreateCommentReq(req); err == nil {
		t.Fatal("expected error for whitespace-only body")
	}
}

func TestValidateCreateCommentReq_EmptyAuthorDefaultsToAnonymous(t *testing.T) {
	req := &db.CreateCommentRequest{Author: "", Body: "hello"}
	if err := validateCreateCommentReq(req); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if req.Author != "anonymous" {
		t.Fatalf("expected author='anonymous', got %q", req.Author)
	}
}

func TestValidateCreateCommentReq_WhitespaceAuthorDefaultsToAnonymous(t *testing.T) {
	req := &db.CreateCommentRequest{Author: "   ", Body: "hello"}
	if err := validateCreateCommentReq(req); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if req.Author != "anonymous" {
		t.Fatalf("expected author='anonymous', got %q", req.Author)
	}
}

// --- validatePagination ---

func TestValidatePagination_Defaults(t *testing.T) {
	c, _ := newEchoCtx(http.MethodGet, "/", "")
	limit, offset, err := validatePagination(c)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if limit != 50 {
		t.Fatalf("expected default limit=50, got %d", limit)
	}
	if offset != 0 {
		t.Fatalf("expected default offset=0, got %d", offset)
	}
}

func TestValidatePagination_LimitTooHigh(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/?limit=501", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	_, _, err := validatePagination(c)
	if err == nil {
		t.Fatal("expected error for limit=501")
	}
}

func TestValidatePagination_OffsetNegative(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/?offset=-1", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	_, _, err := validatePagination(c)
	if err == nil {
		t.Fatal("expected error for offset=-1")
	}
}

func TestValidatePagination_ValidValues(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/?limit=100&offset=50", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	limit, offset, err := validatePagination(c)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if limit != 100 {
		t.Fatalf("expected limit=100, got %d", limit)
	}
	if offset != 50 {
		t.Fatalf("expected offset=50, got %d", offset)
	}
}
