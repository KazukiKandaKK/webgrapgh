package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/hub"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

// wsTestServer wires the WebSocket handler into a running httptest server and
// returns its ws:// URL.
func wsTestServer(t *testing.T, allowed []string) (string, *hub.Hub) {
	t.Helper()
	h := hub.New()
	e := echo.New()
	e.GET("/ws", WebSocket(h, allowed))
	srv := httptest.NewServer(e)
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws", h
}

func TestWebSocket_AllowedOriginConnects(t *testing.T) {
	url, h := wsTestServer(t, []string{"http://localhost:3000"})

	conn, resp, err := websocket.DefaultDialer.Dial(url, http.Header{
		"Origin": {"http://localhost:3000"},
	})
	if err != nil {
		t.Fatalf("dial with allowed origin failed: %v", err)
	}
	defer conn.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Errorf("status = %d, want 101", resp.StatusCode)
	}
	_ = h
}

func TestWebSocket_DisallowedOriginRejected(t *testing.T) {
	url, _ := wsTestServer(t, []string{"http://localhost:3000"})

	conn, resp, err := websocket.DefaultDialer.Dial(url, http.Header{
		"Origin": {"http://evil.example.com"},
	})
	if err == nil {
		conn.Close()
		t.Fatal("dial with disallowed origin succeeded, want rejection")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		got := 0
		if resp != nil {
			got = resp.StatusCode
		}
		t.Errorf("status = %d, want 403", got)
	}
}

func TestWebSocket_MissingOriginRejected(t *testing.T) {
	url, _ := wsTestServer(t, []string{"http://localhost:3000"})

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err == nil {
		conn.Close()
		t.Fatal("dial with no origin succeeded, want rejection")
	}
}
