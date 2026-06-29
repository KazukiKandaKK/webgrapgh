package handler

import (
	"log"
	"net/http"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/hub"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 1 << 12
	sendBuffer     = 64
)

func WebSocket(h *hub.Hub, allowedOrigins []string) echo.HandlerFunc {
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		originSet[o] = struct{}{}
	}
	originAllowed := func(origin string) bool {
		if origin == "" {
			return false
		}
		_, ok := originSet[origin]
		return ok
	}
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			return originAllowed(r.Header.Get("Origin"))
		},
	}

	return func(c echo.Context) error {
		conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
		if err != nil {
			return err
		}
		client := hub.NewClient(sendBuffer)
		if err := h.Register(client); err != nil {
			log.Printf("ws: rejecting client: %v", err)
			_ = conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "too many connections"))
			_ = conn.Close()
			return nil
		}
		log.Printf("ws: client connected (total=%d)", h.Count())

		go readPump(conn, client, h)
		go writePump(conn, client, h)
		return nil
	}
}

func readPump(conn *websocket.Conn, client *hub.Client, h *hub.Hub) {
	defer func() {
		h.Unregister(client)
		_ = conn.Close()
		log.Printf("ws: client disconnected (total=%d)", h.Count())
	}()
	conn.SetReadLimit(maxMessageSize)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func writePump(conn *websocket.Conn, client *hub.Client, h *hub.Hub) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = conn.Close()
	}()
	for {
		select {
		case msg, ok := <-client.Send():
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-client.Done():
			return
		}
	}
}
