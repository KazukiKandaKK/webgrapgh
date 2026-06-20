package metrics

import (
	"math"
	"math/rand"
	"time"
)

// Sample is a single instantaneous reading for every known metric.
type Sample struct {
	TimeMs int64              `json:"t"`
	Values map[string]float64 `json:"v"`
}

// Generator produces continuous synthetic readings that look like a noisy
// sinusoid per metric. It is goroutine-safe to call Next concurrently is NOT
// supported — one goroutine should own the generator.
type Generator struct {
	rng *rand.Rand
}

func NewGenerator() *Generator {
	return &Generator{rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

func (g *Generator) Next(now time.Time, names []string) Sample {
	out := make(map[string]float64, len(names))
	for _, name := range names {
		base, amp, period := shape(name)
		x := float64(now.UnixNano()) / float64(time.Second) / period
		v := base + amp*math.Sin(x*2*math.Pi) + (g.rng.Float64()-0.5)*amp*0.5
		if v < 0 {
			v = 0
		}
		if v > 100 {
			v = 100
		}
		out[name] = v
	}
	return Sample{TimeMs: now.UnixMilli(), Values: out}
}

func shape(name string) (base, amp, period float64) {
	switch name {
	case "cpu":
		return 45, 25, 180
	case "memory":
		return 62, 8, 600
	case "network":
		return 30, 28, 90
	case "disk":
		return 70, 5, 1200
	}
	return 50, 10, 300
}
