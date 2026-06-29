package handler

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestSplitCSV(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", []string{}},
		{"cpu", []string{"cpu"}},
		{"cpu,memory", []string{"cpu", "memory"}},
		{" cpu , memory ", []string{"cpu", "memory"}},
		{"cpu,,memory,", []string{"cpu", "memory"}},
		{" , , ", []string{}},
	}
	for _, tc := range cases {
		got := splitCSV(tc.in)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("splitCSV(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

// History validates query params before touching the DB, so these bad-input
// paths can be exercised with a nil pool and must never reach the database.
func TestHistory_ParamValidation(t *testing.T) {
	cases := []struct {
		name  string
		query string
	}{
		{"all metrics invalid", "metrics=bogus,nope"},
		{"minutes not an integer", "minutes=abc"},
		{"minutes below range", "minutes=0"},
		{"minutes above range", "minutes=1441"},
		{"max_points not an integer", "max_points=xyz"},
		{"max_points below range", "max_points=0"},
		{"max_points above range", "max_points=100001"},
	}

	e := echo.New()
	h := History(nil)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/history?"+tc.query, nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			err := h(c)
			he, ok := err.(*echo.HTTPError)
			if !ok {
				t.Fatalf("expected *echo.HTTPError, got %T (%v)", err, err)
			}
			if he.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want %d", he.Code, http.StatusBadRequest)
			}
		})
	}
}
