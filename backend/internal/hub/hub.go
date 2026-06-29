package hub

import (
	"errors"
	"sync"
)

// DefaultMaxClients is the per-hub ceiling for connected WebSocket clients.
// This prevents a single attacker from exhausting server memory by opening
// thousands of idle connections.
const DefaultMaxClients = 512

// ErrHubFull is returned by Register when the hub has reached its capacity.
var ErrHubFull = errors.New("hub: max clients reached")

// Hub fans out raw byte payloads to every connected WebSocket client.
// Clients that fall behind are dropped instead of slowing the broadcaster.
type Hub struct {
	mu         sync.RWMutex
	clients    map[*Client]struct{}
	maxClients int
}

type Client struct {
	send chan []byte
	done chan struct{}
}

func New() *Hub {
	return &Hub{clients: make(map[*Client]struct{}), maxClients: DefaultMaxClients}
}

// NewWithMax creates a Hub with a custom max-client limit.
func NewWithMax(max int) *Hub {
	if max <= 0 {
		max = DefaultMaxClients
	}
	return &Hub{clients: make(map[*Client]struct{}), maxClients: max}
}

func NewClient(buffer int) *Client {
	return &Client{
		send: make(chan []byte, buffer),
		done: make(chan struct{}),
	}
}

func (c *Client) Send() <-chan []byte { return c.send }
func (c *Client) Done() <-chan struct{} { return c.done }

func (c *Client) Close() {
	select {
	case <-c.done:
	default:
		close(c.done)
	}
}

// Register adds a client to the hub. Returns ErrHubFull if the maximum
// number of clients has been reached.
func (h *Hub) Register(c *Client) error {
	h.mu.Lock()
	if len(h.clients) >= h.maxClients {
		h.mu.Unlock()
		return ErrHubFull
	}
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	return nil
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	c.Close()
}

// Broadcast pushes payload to every client. Slow clients are dropped from the
// hub so the broadcaster never blocks.
func (h *Hub) Broadcast(payload []byte) {
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.send <- payload:
		default:
			h.Unregister(c)
		}
	}
}

// BroadcastExcept is identical to Broadcast except the `sender` client is
// skipped. Used by the Yjs/CRDT relay where echoing an update back to its
// originator would either be ignored (best case) or trip duplicate-state
// detection in the client (worst case).
func (h *Hub) BroadcastExcept(payload []byte, sender *Client) {
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		if c == sender {
			continue
		}
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.send <- payload:
		default:
			h.Unregister(c)
		}
	}
}

func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
