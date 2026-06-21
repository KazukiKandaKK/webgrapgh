package main

import (
	"log"
	"net/http"
	"time"

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

// WSHandler returns an echo.HandlerFunc that upgrades to WebSocket and
// proxies hub broadcasts to the client.
func WSHandler(h *Hub, allowedOrigins []string) echo.HandlerFunc {
	originAllowed := func(origin string) bool {
		if origin == "" {
			return true
		}
		for _, o := range allowedOrigins {
			if o == origin {
				return true
			}
		}
		return false
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
		client := NewClient(sendBuffer)
		h.Register(client)
		log.Printf("bff: ws client connected (total=%d)", h.Count())
		go readPump(conn, client, h)
		go writePump(conn, client, h)
		return nil
	}
}

func readPump(conn *websocket.Conn, client *Client, h *Hub) {
	defer func() {
		h.Unregister(client)
		_ = conn.Close()
		log.Printf("bff: ws client disconnected (total=%d)", h.Count())
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

func writePump(conn *websocket.Conn, client *Client, h *Hub) {
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
