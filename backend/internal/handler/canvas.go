package handler

import (
	"log"
	"net/http"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/hub"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

const canvasMaxMessageSize = 1 << 20 // 1MB — Yjs deltas are tiny, this is plenty

// CanvasWebSocket is the dumb relay for Yjs CRDT traffic. Every binary
// message a client sends is forwarded to every OTHER client (sender
// excluded). The server holds no Y.Doc state — peers synchronize themselves
// via the standard y-websocket sync protocol (sync-step-1 / sync-step-2 /
// update / awareness), all carried as opaque binary frames here.
func CanvasWebSocket(h *hub.Hub, allowedOrigins []string) echo.HandlerFunc {
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
		ReadBufferSize:  4096,
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
		client := hub.NewClient(128)
		if err := h.Register(client); err != nil {
			log.Printf("canvas: rejecting client: %v", err)
			_ = conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "too many connections"))
			_ = conn.Close()
			return nil
		}
		log.Printf("canvas: client connected (total=%d)", h.Count())
		go canvasReadPump(conn, client, h)
		go canvasWritePump(conn, client, h)
		return nil
	}
}

func canvasReadPump(conn *websocket.Conn, client *hub.Client, h *hub.Hub) {
	defer func() {
		h.Unregister(client)
		_ = conn.Close()
		log.Printf("canvas: client disconnected (total=%d)", h.Count())
	}()
	conn.SetReadLimit(canvasMaxMessageSize)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		// Yjs traffic is binary. Anything else (text pings, JSON probes) is
		// silently dropped — we don't want to leak it back to other peers
		// and confuse their Yjs decoders.
		if mt != websocket.BinaryMessage {
			continue
		}
		h.BroadcastExcept(msg, client)
	}
}

func canvasWritePump(conn *websocket.Conn, client *hub.Client, h *hub.Hub) {
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
			if err := conn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
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
