package main

import (
	"fmt"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	logspb "github.com/KazukiKandaKK/webgrapgh/aws-microservices/proto/logs"
)

var (
	levelPool = []string{"INFO", "INFO", "INFO", "INFO", "INFO", "WARN", "WARN", "ERROR", "DEBUG"}
	sources   = []string{"api", "auth", "scheduler", "cache", "queue", "ingest", "worker"}
)

type Generator struct {
	mu     sync.Mutex
	rng    *rand.Rand
	nextID atomic.Int64
}

func NewGenerator() *Generator {
	return &Generator{rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

func (g *Generator) Next(now time.Time) *logspb.LogEvent {
	g.mu.Lock()
	defer g.mu.Unlock()
	level := levelPool[g.rng.Intn(len(levelPool))]
	src := sources[g.rng.Intn(len(sources))]
	return &logspb.LogEvent{
		Id:          g.nextID.Add(1),
		TimestampMs: now.UnixMilli(),
		Level:       level,
		Source:      src,
		Message:     g.message(level),
	}
}

func (g *Generator) message(level string) string {
	switch level {
	case "ERROR":
		switch g.rng.Intn(3) {
		case 0:
			return fmt.Sprintf("dial tcp 10.0.%d.%d:5432: connect: refused",
				g.rng.Intn(255), g.rng.Intn(255))
		case 1:
			return fmt.Sprintf("upstream timeout %dms (endpoint=/v1/items)",
				1000+g.rng.Intn(4000))
		default:
			return fmt.Sprintf("panic recovered: nil dereference (id=%d)",
				g.rng.Intn(99999))
		}
	case "WARN":
		switch g.rng.Intn(2) {
		case 0:
			return fmt.Sprintf("slow query %dms (table=events)", 200+g.rng.Intn(800))
		default:
			return fmt.Sprintf("retry %d/3 for job-%d",
				1+g.rng.Intn(3), g.rng.Intn(9999))
		}
	case "DEBUG":
		return fmt.Sprintf("trace span=%x dur=%dµs",
			g.rng.Int63(), 10+g.rng.Intn(500))
	}
	switch g.rng.Intn(5) {
	case 0:
		return fmt.Sprintf("request handled in %dms", 5+g.rng.Intn(400))
	case 1:
		return fmt.Sprintf("user %d signed in", g.rng.Intn(99999))
	case 2:
		return fmt.Sprintf("task job-%d completed in %dms",
			g.rng.Intn(9999), 50+g.rng.Intn(1500))
	case 3:
		return fmt.Sprintf("SELECT * FROM events LIMIT %d → %d rows",
			10+g.rng.Intn(1000), g.rng.Intn(1000))
	}
	return fmt.Sprintf("processed batch of %d items", 1+g.rng.Intn(200))
}
