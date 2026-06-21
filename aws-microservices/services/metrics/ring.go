package main

import (
	"sync"

	metricspb "github.com/KazukiKandaKK/webgrapgh/aws-microservices/proto/metrics"
)

// Ring is a fixed-capacity FIFO of Ticks used to satisfy GetHistory without
// requiring a database. Older entries are overwritten in place once capacity
// is reached. Thread-safe.
type Ring struct {
	mu       sync.RWMutex
	capacity int
	buf      []*metricspb.Tick
	head     int
	size     int
}

func NewRing(capacity int) *Ring {
	return &Ring{capacity: capacity, buf: make([]*metricspb.Tick, capacity)}
}

func (r *Ring) Append(t *metricspb.Tick) {
	r.mu.Lock()
	r.buf[r.head] = t
	r.head = (r.head + 1) % r.capacity
	if r.size < r.capacity {
		r.size++
	}
	r.mu.Unlock()
}

// Snapshot returns Ticks within [fromMs, toMs) in chronological order.
// toMs <= 0 means "no upper bound". Returns at most `cap` entries; if more
// rows match, the result is stride-downsampled and always includes the
// newest matching entry.
func (r *Ring) Snapshot(fromMs, toMs int64, cap int) []*metricspb.Tick {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.size == 0 {
		return nil
	}
	startIdx := 0
	if r.size == r.capacity {
		startIdx = r.head
	}
	out := make([]*metricspb.Tick, 0, r.size)
	for i := 0; i < r.size; i++ {
		t := r.buf[(startIdx+i)%r.capacity]
		if t == nil {
			continue
		}
		if t.TimestampMs < fromMs {
			continue
		}
		if toMs > 0 && t.TimestampMs >= toMs {
			break
		}
		out = append(out, t)
	}
	if cap > 0 && len(out) > cap {
		stride := (len(out) + cap - 1) / cap
		sampled := make([]*metricspb.Tick, 0, cap+1)
		for i := 0; i < len(out); i += stride {
			sampled = append(sampled, out[i])
		}
		if last := out[len(out)-1]; sampled[len(sampled)-1] != last {
			sampled = append(sampled, last)
		}
		out = sampled
	}
	return out
}

// Broadcast — pub/sub for realtime streams. New subscribers are registered
// with `Subscribe` and unregistered by closing the returned cancel function.
type Broadcaster struct {
	mu          sync.RWMutex
	subscribers map[chan *metricspb.Tick]struct{}
}

func NewBroadcaster() *Broadcaster {
	return &Broadcaster{subscribers: make(map[chan *metricspb.Tick]struct{})}
}

// Subscribe returns a buffered channel that will receive new Ticks until
// the returned cancel function is called.
func (b *Broadcaster) Subscribe(buffer int) (<-chan *metricspb.Tick, func()) {
	ch := make(chan *metricspb.Tick, buffer)
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

// Publish fans out without blocking. Slow subscribers see drops (we favour
// freshness over completeness — this is realtime telemetry, not a queue).
func (b *Broadcaster) Publish(t *metricspb.Tick) {
	b.mu.RLock()
	for ch := range b.subscribers {
		select {
		case ch <- t:
		default:
		}
	}
	b.mu.RUnlock()
}
