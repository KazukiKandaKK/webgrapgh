package main

import (
	"testing"
	"time"

	"github.com/KazukiKandaKK/webgrapgh/backend/internal/dockerstats"
)

func TestPrevNet_RateDerivation(t *testing.T) {
	// Simulate two consecutive collection cycles for a container.
	// First cycle: no prev entry → rates should be 0.
	prev := make(map[string]prevNet)
	containerID := "abc123"

	s1 := dockerstats.Sample{NetRxBytes: 1000, NetTxBytes: 500}
	t0 := time.Now()

	// First cycle: no prev → we record but rates are 0.
	var rxBps1, txBps1 float64
	if p, ok := prev[containerID]; ok {
		dt := t0.Sub(p.at).Seconds()
		rxBps1 = dockerstats.Rate(p.rx, s1.NetRxBytes, dt)
		txBps1 = dockerstats.Rate(p.tx, s1.NetTxBytes, dt)
	}
	prev[containerID] = prevNet{rx: s1.NetRxBytes, tx: s1.NetTxBytes, at: t0}

	if rxBps1 != 0 || txBps1 != 0 {
		t.Fatalf("first cycle: rx/tx = %v/%v, want 0/0", rxBps1, txBps1)
	}

	// Second cycle 1s later: 200 rx bytes, 100 tx bytes accumulated.
	s2 := dockerstats.Sample{NetRxBytes: 1200, NetTxBytes: 600}
	t1 := t0.Add(time.Second)

	var rxBps2, txBps2 float64
	if p, ok := prev[containerID]; ok {
		dt := t1.Sub(p.at).Seconds()
		rxBps2 = dockerstats.Rate(p.rx, s2.NetRxBytes, dt)
		txBps2 = dockerstats.Rate(p.tx, s2.NetTxBytes, dt)
	}
	prev[containerID] = prevNet{rx: s2.NetRxBytes, tx: s2.NetTxBytes, at: t1}

	if rxBps2 != 200 {
		t.Fatalf("second cycle: rxBps = %v, want 200", rxBps2)
	}
	if txBps2 != 100 {
		t.Fatalf("second cycle: txBps = %v, want 100", txBps2)
	}
}

func TestPrevNet_ContainerDisappears(t *testing.T) {
	// Containers that vanish between cycles should be cleaned up from prev.
	prev := map[string]prevNet{
		"alive": {rx: 100, tx: 50, at: time.Now()},
		"gone":  {rx: 200, tx: 80, at: time.Now()},
	}

	// Only "alive" is seen this cycle.
	seen := map[string]struct{}{"alive": {}}
	for id := range prev {
		if _, ok := seen[id]; !ok {
			delete(prev, id)
		}
	}

	if _, ok := prev["gone"]; ok {
		t.Fatal("expected 'gone' to be removed from prev")
	}
	if _, ok := prev["alive"]; !ok {
		t.Fatal("expected 'alive' to remain in prev")
	}
}

func TestPrevNet_CounterReset(t *testing.T) {
	// When a container restarts, cumulative counters reset to 0.
	// Rate should clamp to 0 (not negative).
	prev := map[string]prevNet{
		"c1": {rx: 5000, tx: 3000, at: time.Now()},
	}

	// After restart: counters are less than prev.
	s := dockerstats.Sample{NetRxBytes: 100, NetTxBytes: 50}
	t1 := time.Now().Add(time.Second)

	p := prev["c1"]
	dt := t1.Sub(p.at).Seconds()
	rx := dockerstats.Rate(p.rx, s.NetRxBytes, dt)
	tx := dockerstats.Rate(p.tx, s.NetTxBytes, dt)

	if rx != 0 {
		t.Fatalf("rx after reset = %v, want 0", rx)
	}
	if tx != 0 {
		t.Fatalf("tx after reset = %v, want 0", tx)
	}
}
