package main

import (
	"sync"
)

// Hub fans out raw byte payloads to every registered Client without blocking
// on any individual slow client (the slow client just gets dropped).
type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]struct{}
}

type Client struct {
	send chan []byte
	done chan struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*Client]struct{})}
}

func NewClient(buffer int) *Client {
	return &Client{
		send: make(chan []byte, buffer),
		done: make(chan struct{}),
	}
}

func (c *Client) Send() <-chan []byte    { return c.send }
func (c *Client) Done() <-chan struct{}  { return c.done }
func (c *Client) Close() {
	select {
	case <-c.done:
	default:
		close(c.done)
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	c.Close()
}

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

func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
