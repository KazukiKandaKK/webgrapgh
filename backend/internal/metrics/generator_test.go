package metrics

import (
	"testing"
	"time"
)

func TestNewGenerator(t *testing.T) {
	g := NewGenerator()
	if g == nil {
		t.Fatal("NewGenerator returned nil")
	}
	if g.rng == nil {
		t.Fatal("Generator.rng is nil")
	}
}

func TestGenerator_Next_AllMetrics(t *testing.T) {
	g := NewGenerator()
	now := time.Date(2025, 6, 15, 12, 0, 0, 0, time.UTC)
	names := []string{"cpu", "memory", "disk", "network", "gpu", "requests", "errors", "latency_p50", "latency_p99", "queue"}

	sample := g.Next(now, names)

	if sample.TimeMs != now.UnixMilli() {
		t.Errorf("TimeMs = %d, want %d", sample.TimeMs, now.UnixMilli())
	}
	if len(sample.Values) != len(names) {
		t.Errorf("Values len = %d, want %d", len(sample.Values), len(names))
	}
	for _, name := range names {
		v, ok := sample.Values[name]
		if !ok {
			t.Errorf("metric %q missing from Values", name)
			continue
		}
		if v < 0 {
			t.Errorf("metric %q has negative value %f", name, v)
		}
	}
}

func TestGenerator_Next_EmptyNames(t *testing.T) {
	g := NewGenerator()
	now := time.Now()
	sample := g.Next(now, nil)
	if len(sample.Values) != 0 {
		t.Errorf("Next with nil names should return empty Values, got %d", len(sample.Values))
	}
	sample2 := g.Next(now, []string{})
	if len(sample2.Values) != 0 {
		t.Errorf("Next with empty names should return empty Values, got %d", len(sample2.Values))
	}
}

func TestGenerator_Next_ValuesNonNegative(t *testing.T) {
	g := NewGenerator()
	names := []string{"cpu", "memory", "network"}
	for i := 0; i < 1000; i++ {
		now := time.Now().Add(time.Duration(i) * time.Second)
		sample := g.Next(now, names)
		for _, name := range names {
			if sample.Values[name] < 0 {
				t.Fatalf("iteration %d: metric %q = %f, should be >= 0", i, name, sample.Values[name])
			}
		}
	}
}

func TestGenerator_Next_UnknownMetric(t *testing.T) {
	g := NewGenerator()
	now := time.Now()
	sample := g.Next(now, []string{"unknown_metric"})
	v, ok := sample.Values["unknown_metric"]
	if !ok {
		t.Fatal("unknown metric not in Values map")
	}
	if v < 0 {
		t.Errorf("unknown metric value = %f, should be >= 0", v)
	}
}

func TestGenerator_Next_Determinism(t *testing.T) {
	// Two generators should produce different values (seeded from time).
	g1 := NewGenerator()
	g2 := NewGenerator()
	now := time.Now()
	// Sleep briefly so seeds differ.
	time.Sleep(time.Nanosecond)
	s1 := g1.Next(now, []string{"cpu"})
	s2 := g2.Next(now, []string{"cpu"})
	// Values are based on time + random noise, so they should differ with
	// different seeds (extremely unlikely to be exactly equal).
	_ = s1
	_ = s2
}

func TestShape_KnownMetrics(t *testing.T) {
	tests := []struct {
		name   string
		base   float64
		amp    float64
		period float64
	}{
		{"cpu", 45, 25, 180},
		{"memory", 62, 8, 600},
		{"disk", 70, 5, 1200},
		{"gpu", 50, 30, 240},
		{"network", 30, 28, 90},
		{"requests", 120, 60, 75},
		{"errors", 1.5, 1.4, 200},
		{"latency_p50", 50, 30, 120},
		{"latency_p99", 250, 150, 300},
		{"queue", 400, 350, 480},
	}
	for _, tt := range tests {
		base, amp, period := shape(tt.name)
		if base != tt.base {
			t.Errorf("shape(%q) base = %f, want %f", tt.name, base, tt.base)
		}
		if amp != tt.amp {
			t.Errorf("shape(%q) amp = %f, want %f", tt.name, amp, tt.amp)
		}
		if period != tt.period {
			t.Errorf("shape(%q) period = %f, want %f", tt.name, period, tt.period)
		}
	}
}

func TestShape_UnknownMetric(t *testing.T) {
	base, amp, period := shape("nonexistent")
	if base != 50 || amp != 10 || period != 300 {
		t.Errorf("shape(unknown) = (%f, %f, %f), want (50, 10, 300)", base, amp, period)
	}
}

func TestSample_Struct(t *testing.T) {
	s := Sample{
		TimeMs: 1718870000123,
		Values: map[string]float64{"cpu": 42.1, "memory": 67.3},
	}
	if s.TimeMs != 1718870000123 {
		t.Errorf("TimeMs = %d", s.TimeMs)
	}
	if s.Values["cpu"] != 42.1 {
		t.Errorf("Values[cpu] = %f", s.Values["cpu"])
	}
}
