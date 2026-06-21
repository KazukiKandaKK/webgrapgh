package main

import (
	"sync"

	logspb "github.com/KazukiKandaKK/webgrapgh/aws-microservices/proto/logs"
)

type Ring struct {
	mu       sync.RWMutex
	capacity int
	buf      []*logspb.LogEvent
	head     int
	size     int
}

func NewRing(capacity int) *Ring {
	return &Ring{capacity: capacity, buf: make([]*logspb.LogEvent, capacity)}
}

func (r *Ring) Append(ev *logspb.LogEvent) {
	r.mu.Lock()
	r.buf[r.head] = ev
	r.head = (r.head + 1) % r.capacity
	if r.size < r.capacity {
		r.size++
	}
	r.mu.Unlock()
}

// Snapshot returns up to `limit` newest events in chronological order.
func (r *Ring) Snapshot(limit int) []*logspb.LogEvent {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if limit <= 0 || limit > r.size {
		limit = r.size
	}
	out := make([]*logspb.LogEvent, 0, limit)
	start := (r.head - limit + r.capacity) % r.capacity
	for i := 0; i < limit; i++ {
		out = append(out, r.buf[(start+i)%r.capacity])
	}
	return out
}

func (r *Ring) Size() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.size
}
func (r *Ring) Capacity() int { return r.capacity }

// Broadcaster — pub/sub of LogEvents to active StreamRealtime clients.
type Broadcaster struct {
	mu          sync.RWMutex
	subscribers map[chan *logspb.LogEvent]struct{}
}

func NewBroadcaster() *Broadcaster {
	return &Broadcaster{subscribers: make(map[chan *logspb.LogEvent]struct{})}
}

func (b *Broadcaster) Subscribe(buffer int) (<-chan *logspb.LogEvent, func()) {
	ch := make(chan *logspb.LogEvent, buffer)
	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if _, ok := b.subscribers[ch]; ok {
			delete(b.subscribers, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}

func (b *Broadcaster) Publish(ev *logspb.LogEvent) {
	b.mu.RLock()
	for ch := range b.subscribers {
		select {
		case ch <- ev:
		default:
		}
	}
	b.mu.RUnlock()
}
