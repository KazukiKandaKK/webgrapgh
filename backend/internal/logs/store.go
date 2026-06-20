// Package logs provides an in-memory ring buffer of synthetic log events and a
// generator that fills it. Logs are NOT persisted to PostgreSQL — the store is
// the authoritative source for /api/logs/history and disappears on restart
// (re-seeded automatically).
package logs

import (
	"sync"
	"sync/atomic"
)

// Event is the wire shape of a single log entry. Field tags are deliberately
// short to keep WS frames small.
type Event struct {
	ID      int64  `json:"id"`
	TimeMs  int64  `json:"t"`
	Level   string `json:"level"`
	Source  string `json:"src"`
	Message string `json:"msg"`
}

// Store is a goroutine-safe ring buffer of Events.
type Store struct {
	capacity int
	mu       sync.RWMutex
	buf      []Event
	head     int
	size     int
	nextID   atomic.Int64
}

func NewStore(capacity int) *Store {
	if capacity <= 0 {
		capacity = 10000
	}
	return &Store{capacity: capacity, buf: make([]Event, capacity)}
}

// NewID returns a strictly monotonic event ID.
func (s *Store) NewID() int64 { return s.nextID.Add(1) }

// Append writes ev into the ring, assigning an ID if zero. Returns the stored
// event (with ID populated) so the caller can broadcast the same value.
func (s *Store) Append(ev Event) Event {
	if ev.ID == 0 {
		ev.ID = s.NewID()
	}
	s.mu.Lock()
	s.buf[s.head] = ev
	s.head = (s.head + 1) % s.capacity
	if s.size < s.capacity {
		s.size++
	}
	s.mu.Unlock()
	return ev
}

// Snapshot returns up to `limit` newest events in chronological order
// (oldest first). limit <= 0 means "all currently stored events".
func (s *Store) Snapshot(limit int) []Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 || limit > s.size {
		limit = s.size
	}
	out := make([]Event, limit)
	// Newest is at (head-1). The `limit` newest start at (head-limit).
	start := (s.head - limit + s.capacity) % s.capacity
	for i := 0; i < limit; i++ {
		out[i] = s.buf[(start+i)%s.capacity]
	}
	return out
}

func (s *Store) Size() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.size
}

func (s *Store) Capacity() int { return s.capacity }
