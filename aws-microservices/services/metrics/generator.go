package main

import (
	"math"
	"math/rand"
	"sync"
	"time"

	metricspb "github.com/KazukiKandaKK/webgrapgh/aws-microservices/proto/metrics"
)

var MetricNames = []string{
	"cpu", "memory", "disk", "network",
	"gpu", "requests", "errors",
	"latency_p50", "latency_p99", "queue",
}

// shape returns the (base, amplitude, period_seconds) of the synthetic sin
// wave for a metric. Same coefficients as the monolith so dashboards behave
// the same when swapping backends.
func shape(name string) (base, amp, period float64) {
	switch name {
	case "cpu":
		return 45, 25, 180
	case "memory":
		return 62, 8, 600
	case "disk":
		return 70, 5, 1200
	case "gpu":
		return 50, 30, 240
	case "network":
		return 30, 28, 90
	case "requests":
		return 120, 60, 75
	case "errors":
		return 1.5, 1.4, 200
	case "latency_p50":
		return 50, 30, 120
	case "latency_p99":
		return 250, 150, 300
	case "queue":
		return 400, 350, 480
	}
	return 50, 10, 300
}

type Generator struct {
	mu  sync.Mutex
	rng *rand.Rand
}

func NewGenerator() *Generator {
	return &Generator{rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

// Tick produces one synthetic Tick covering all `names`.
func (g *Generator) Tick(now time.Time, names []string) *metricspb.Tick {
	values := make(map[string]float64, len(names))
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, name := range names {
		base, amp, period := shape(name)
		x := float64(now.UnixNano()) / float64(time.Second) / period
		v := base + amp*math.Sin(x*2*math.Pi) + (g.rng.Float64()-0.5)*amp*0.5
		if v < 0 {
			v = 0
		}
		values[name] = v
	}
	return &metricspb.Tick{
		TimestampMs: now.UnixMilli(),
		Values:      values,
	}
}
