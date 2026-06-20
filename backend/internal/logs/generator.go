package logs

import (
	"fmt"
	"math/rand"
	"time"
)

var (
	// Weighted level list — duplicates raise the chance of the level.
	levelPool = []string{"INFO", "INFO", "INFO", "INFO", "INFO", "WARN", "WARN", "ERROR", "DEBUG"}
	sources   = []string{"api", "auth", "scheduler", "cache", "queue", "ingest", "worker"}
)

type Generator struct {
	rng *rand.Rand
}

func NewGenerator() *Generator {
	return &Generator{rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

// Next produces a pseudo log entry. The returned Event has no ID — let the
// Store assign one on Append.
func (g *Generator) Next(now time.Time) Event {
	level := levelPool[g.rng.Intn(len(levelPool))]
	src := sources[g.rng.Intn(len(sources))]
	msg := g.message(level)
	return Event{
		TimeMs:  now.UnixMilli(),
		Level:   level,
		Source:  src,
		Message: msg,
	}
}

func (g *Generator) message(level string) string {
	if level == "ERROR" {
		switch g.rng.Intn(4) {
		case 0:
			return fmt.Sprintf("dial tcp 10.0.%d.%d:5432: connect: connection refused",
				g.rng.Intn(255), g.rng.Intn(255))
		case 1:
			return fmt.Sprintf("panic recovered: nil pointer dereference at handler.Process (id=%d)", g.rng.Intn(99999))
		case 2:
			return fmt.Sprintf("upstream timeout after %dms (endpoint=/v1/items)", 1000+g.rng.Intn(4000))
		default:
			return fmt.Sprintf("auth failed for user=%d ip=10.%d.%d.%d", g.rng.Intn(9999), g.rng.Intn(255), g.rng.Intn(255), g.rng.Intn(255))
		}
	}
	if level == "WARN" {
		switch g.rng.Intn(3) {
		case 0:
			return fmt.Sprintf("slow query %dms threshold=200ms (table=events)", 200+g.rng.Intn(800))
		case 1:
			return fmt.Sprintf("retry %d/3 for job-%d", 1+g.rng.Intn(3), g.rng.Intn(9999))
		default:
			return fmt.Sprintf("rate limit hit %d/100 client=%d", 90+g.rng.Intn(15), g.rng.Intn(999))
		}
	}
	if level == "DEBUG" {
		return fmt.Sprintf("trace span=%x duration=%dµs", g.rng.Int63(), 10+g.rng.Intn(500))
	}
	switch g.rng.Intn(6) {
	case 0:
		return fmt.Sprintf("request handled in %dms", 5+g.rng.Intn(400))
	case 1:
		return fmt.Sprintf("cache miss for key user:%d (size=%dB)", g.rng.Intn(99999), 100+g.rng.Intn(4000))
	case 2:
		return fmt.Sprintf("user %d signed in from 10.0.%d.%d", g.rng.Intn(99999), g.rng.Intn(255), g.rng.Intn(255))
	case 3:
		return fmt.Sprintf("task job-%d completed in %dms", g.rng.Intn(9999), 50+g.rng.Intn(1500))
	case 4:
		return fmt.Sprintf("SELECT * FROM events LIMIT %d → %d rows in %dms", 10+g.rng.Intn(1000), g.rng.Intn(1000), 1+g.rng.Intn(200))
	default:
		return fmt.Sprintf("processed batch of %d items", 1+g.rng.Intn(200))
	}
}

// SeedHistory fills the store with `count` synthetic events evenly spread
// across [now - window, now]. Used at startup so /api/logs/history isn't empty
// on first load.
func SeedHistory(store *Store, window time.Duration, count int) {
	g := NewGenerator()
	end := time.Now()
	start := end.Add(-window)
	if count <= 0 {
		return
	}
	step := window / time.Duration(count)
	for i := 0; i < count; i++ {
		t := start.Add(step * time.Duration(i))
		ev := g.Next(t)
		ev.TimeMs = t.UnixMilli()
		store.Append(ev)
	}
}
