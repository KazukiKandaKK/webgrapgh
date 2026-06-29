package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/logs"
	"github.com/labstack/echo/v4"
)

func seedStore(t *testing.T, n int) *logs.Store {
	t.Helper()
	store := logs.NewStore(100)
	for i := 0; i < n; i++ {
		store.Append(logs.Event{Level: "INFO", Source: "test", Message: "m"})
	}
	return store
}

func TestLogsHistory_DefaultReturnsAll(t *testing.T) {
	store := seedStore(t, 5)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/history", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := LogsHistory(store)(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []logs.Event
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 5 {
		t.Errorf("returned %d events, want 5", len(got))
	}
}

func TestLogsHistory_LimitClampsToWindow(t *testing.T) {
	store := seedStore(t, 10)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/logs/history?limit=3", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := LogsHistory(store)(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	var got []logs.Event
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 3 {
		t.Errorf("returned %d events, want 3 (limit)", len(got))
	}
}

func TestLogsHistory_InvalidLimit(t *testing.T) {
	store := seedStore(t, 5)
	e := echo.New()
	for _, q := range []string{"limit=abc", "limit=0", "limit=99999999"} {
		req := httptest.NewRequest(http.MethodGet, "/api/logs/history?"+q, nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := LogsHistory(store)(c)
		he, ok := err.(*echo.HTTPError)
		if !ok {
			t.Fatalf("%s: expected *echo.HTTPError, got %T", q, err)
		}
		if he.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", q, he.Code)
		}
	}
}
