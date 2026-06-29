package db

import (
	"math"
	"math/rand"
	"testing"
	"time"
)

func TestMetricShape_KnownAndDefault(t *testing.T) {
	// Every canonical metric must have a defined shape with sane bounds.
	for _, name := range MetricNames {
		base, amp, period := metricShape(name)
		if period <= 0 {
			t.Errorf("metricShape(%q) period = %v, want > 0", name, period)
		}
		if amp < 0 {
			t.Errorf("metricShape(%q) amp = %v, want >= 0", name, amp)
		}
		if base < 0 {
			t.Errorf("metricShape(%q) base = %v, want >= 0", name, base)
		}
	}

	// Unknown names fall back to the documented default.
	base, amp, period := metricShape("does-not-exist")
	if base != 50 || amp != 10 || period != 300 {
		t.Errorf("metricShape(unknown) = (%v,%v,%v), want (50,10,300)", base, amp, period)
	}
}

func TestSyntheticValue_DeterministicAndClamped(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	// Same seed => same value (reproducible series).
	a := syntheticValue(50, 25, 180, now, rand.New(rand.NewSource(1)))
	b := syntheticValue(50, 25, 180, now, rand.New(rand.NewSource(1)))
	if a != b {
		t.Errorf("syntheticValue not deterministic for equal seeds: %v != %v", a, b)
	}

	// Never negative, even when base is tiny and the sine dips low.
	for i := 0; i < 1000; i++ {
		v := syntheticValue(0.1, 5, 200, now.Add(time.Duration(i)*time.Second), rand.New(rand.NewSource(int64(i))))
		if v < 0 {
			t.Fatalf("syntheticValue produced negative value %v at i=%d", v, i)
		}
		if math.IsNaN(v) {
			t.Fatalf("syntheticValue produced NaN at i=%d", i)
		}
	}
}

func TestCopyRowsSrc_Iteration(t *testing.T) {
	rows := [][]any{
		{time.Unix(1, 0), "cpu", 1.0},
		{time.Unix(2, 0), "cpu", 2.0},
	}
	src := newCopyRows(rows)

	count := 0
	for src.Next() {
		vals, err := src.Values()
		if err != nil {
			t.Fatalf("Values() error: %v", err)
		}
		if len(vals) != 3 {
			t.Fatalf("row %d: got %d values, want 3", count, len(vals))
		}
		count++
	}
	if count != len(rows) {
		t.Errorf("iterated %d rows, want %d", count, len(rows))
	}
	if src.Next() {
		t.Error("Next() returned true after exhaustion")
	}
	if err := src.Err(); err != nil {
		t.Errorf("Err() = %v, want nil", err)
	}
}

func TestCopyRowsSrc_Empty(t *testing.T) {
	src := newCopyRows(nil)
	if src.Next() {
		t.Error("Next() on empty source returned true")
	}
}
