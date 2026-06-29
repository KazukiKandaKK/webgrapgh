package dockerstats

import (
	"encoding/json"
	"math"
	"testing"
)

func approx(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func TestCompute_CPUPercent(t *testing.T) {
	s := &StatsJSON{}
	// cpuDelta = 200-100 = 100, systemDelta = 2000-1000 = 1000, online = 4
	// => 100/1000 * 4 * 100 = 40%
	s.CPUStats.CPUUsage.TotalUsage = 200
	s.PreCPUStats.CPUUsage.TotalUsage = 100
	s.CPUStats.SystemUsage = 2000
	s.PreCPUStats.SystemUsage = 1000
	s.CPUStats.OnlineCPUs = 4

	got := Compute(s).CPUPercent
	if !approx(got, 40) {
		t.Fatalf("CPUPercent = %v, want 40", got)
	}
}

func TestCompute_CPUPercent_FallsBackToPerCPULen(t *testing.T) {
	s := &StatsJSON{}
	s.CPUStats.CPUUsage.TotalUsage = 150
	s.PreCPUStats.CPUUsage.TotalUsage = 100
	s.CPUStats.SystemUsage = 1100
	s.PreCPUStats.SystemUsage = 1000
	s.CPUStats.CPUUsage.PerCPUUsage = []uint64{1, 2} // online_cpus unset -> len=2
	// 50/100 * 2 * 100 = 100%
	if got := Compute(s).CPUPercent; !approx(got, 100) {
		t.Fatalf("CPUPercent = %v, want 100", got)
	}
}

func TestCompute_CPUPercent_ZeroDeltaIsZero(t *testing.T) {
	s := &StatsJSON{}
	s.CPUStats.CPUUsage.TotalUsage = 100
	s.PreCPUStats.CPUUsage.TotalUsage = 100 // no delta
	s.CPUStats.SystemUsage = 2000
	s.PreCPUStats.SystemUsage = 1000
	if got := Compute(s).CPUPercent; got != 0 {
		t.Fatalf("CPUPercent = %v, want 0", got)
	}
}

func TestCompute_MemorySubtractsCache(t *testing.T) {
	s := &StatsJSON{}
	s.MemoryStats.Usage = 1000
	s.MemoryStats.Limit = 4000
	s.MemoryStats.Stats = map[string]uint64{"total_inactive_file": 400}
	out := Compute(s)
	if out.MemBytes != 600 {
		t.Fatalf("MemBytes = %v, want 600", out.MemBytes)
	}
	if !approx(out.MemPercent, 15) { // 600/4000 = 15%
		t.Fatalf("MemPercent = %v, want 15", out.MemPercent)
	}
	if out.MemLimitBytes != 4000 {
		t.Fatalf("MemLimitBytes = %v, want 4000", out.MemLimitBytes)
	}
}

func TestCompute_MemoryCgroupV2InactiveFile(t *testing.T) {
	s := &StatsJSON{}
	s.MemoryStats.Usage = 1000
	s.MemoryStats.Limit = 2000
	s.MemoryStats.Stats = map[string]uint64{"inactive_file": 250}
	if got := Compute(s).MemBytes; got != 750 {
		t.Fatalf("MemBytes = %v, want 750", got)
	}
}

func TestCompute_MemoryNoStatsUsesRawUsage(t *testing.T) {
	s := &StatsJSON{}
	s.MemoryStats.Usage = 1000
	s.MemoryStats.Limit = 0 // no limit -> percent stays 0
	out := Compute(s)
	if out.MemBytes != 1000 {
		t.Fatalf("MemBytes = %v, want 1000", out.MemBytes)
	}
	if out.MemPercent != 0 {
		t.Fatalf("MemPercent = %v, want 0", out.MemPercent)
	}
}

func TestCompute_NetworkSumsInterfaces(t *testing.T) {
	s := &StatsJSON{Networks: map[string]NetworkStats{
		"eth0": {RxBytes: 100, TxBytes: 10},
		"eth1": {RxBytes: 50, TxBytes: 5},
	}}
	out := Compute(s)
	if out.NetRxBytes != 150 || out.NetTxBytes != 15 {
		t.Fatalf("net rx/tx = %v/%v, want 150/15", out.NetRxBytes, out.NetTxBytes)
	}
}

func TestRate(t *testing.T) {
	cases := []struct {
		prev, cur, dt, want float64
	}{
		{100, 300, 2, 100}, // 200 bytes over 2s
		{100, 100, 1, 0},   // no change
		{300, 100, 1, 0},   // counter reset -> clamp
		{100, 200, 0, 0},   // dt=0 -> clamp
		{100, 200, -1, 0},  // negative dt -> clamp
	}
	for i, c := range cases {
		if got := Rate(c.prev, c.cur, c.dt); !approx(got, c.want) {
			t.Fatalf("case %d: Rate(%v,%v,%v) = %v, want %v", i, c.prev, c.cur, c.dt, got, c.want)
		}
	}
}

func TestContainer_Name(t *testing.T) {
	if got := (Container{Names: []string{"/webgraph-backend"}}).Name(); got != "webgraph-backend" {
		t.Fatalf("Name = %q, want webgraph-backend", got)
	}
	if got := (Container{ID: "abcdef0123456789"}).Name(); got != "abcdef012345" {
		t.Fatalf("Name = %q, want short id", got)
	}
}

func TestStatsJSON_Unmarshal(t *testing.T) {
	// A trimmed real-world payload decodes into the expected fields.
	const raw = `{
	  "cpu_stats": {"cpu_usage": {"total_usage": 200, "percpu_usage": [1,2]}, "system_cpu_usage": 2000, "online_cpus": 2},
	  "precpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 1000},
	  "memory_stats": {"usage": 1000, "limit": 4000, "stats": {"inactive_file": 200}},
	  "networks": {"eth0": {"rx_bytes": 123, "tx_bytes": 45}}
	}`
	var s StatsJSON
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	out := Compute(&s)
	if !approx(out.CPUPercent, 20) { // 100/1000*2*100
		t.Fatalf("CPUPercent = %v, want 20", out.CPUPercent)
	}
	if out.MemBytes != 800 || out.NetRxBytes != 123 {
		t.Fatalf("mem/net = %v/%v, want 800/123", out.MemBytes, out.NetRxBytes)
	}
}
