package dockerstats

import "time"

// StatsJSON mirrors the subset of GET /containers/{id}/stats we consume. Field
// names match the Docker Engine API JSON.
type StatsJSON struct {
	Read        time.Time   `json:"read"`
	CPUStats    CPUStats    `json:"cpu_stats"`
	PreCPUStats CPUStats    `json:"precpu_stats"`
	MemoryStats MemoryStats `json:"memory_stats"`
	// Networks is keyed by interface name (e.g. "eth0").
	Networks map[string]NetworkStats `json:"networks"`
}

type CPUStats struct {
	CPUUsage struct {
		TotalUsage  uint64   `json:"total_usage"`
		PerCPUUsage []uint64 `json:"percpu_usage"`
	} `json:"cpu_usage"`
	SystemUsage uint64 `json:"system_cpu_usage"`
	OnlineCPUs  uint32 `json:"online_cpus"`
}

type MemoryStats struct {
	Usage uint64            `json:"usage"`
	Limit uint64            `json:"limit"`
	Stats map[string]uint64 `json:"stats"`
}

type NetworkStats struct {
	RxBytes uint64 `json:"rx_bytes"`
	TxBytes uint64 `json:"tx_bytes"`
}

// Sample is the set of derived gauges for one container at one reading.
type Sample struct {
	CPUPercent    float64
	MemBytes      float64
	MemLimitBytes float64
	MemPercent    float64
	// Cumulative network counters (bytes since container start). Rates are
	// derived across consecutive samples by the collector.
	NetRxBytes float64
	NetTxBytes float64
}

// Compute derives the gauges from a single stats reading. It is pure (no I/O)
// so the index/delta arithmetic — the bug-prone part — is unit-testable.
//
// CPU% follows the Docker CLI: (cpuDelta / systemDelta) * onlineCPUs * 100.
// Memory subtracts the page cache (inactive_file) like `docker stats` so the
// figure reflects the working set rather than reclaimable cache.
func Compute(s *StatsJSON) Sample {
	var out Sample

	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage) - float64(s.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(s.CPUStats.SystemUsage) - float64(s.PreCPUStats.SystemUsage)
	if cpuDelta > 0 && systemDelta > 0 {
		online := float64(s.CPUStats.OnlineCPUs)
		if online == 0 {
			online = float64(len(s.CPUStats.CPUUsage.PerCPUUsage))
		}
		if online == 0 {
			online = 1
		}
		out.CPUPercent = (cpuDelta / systemDelta) * online * 100
	}

	used := memUsageNoCache(s.MemoryStats)
	out.MemBytes = float64(used)
	out.MemLimitBytes = float64(s.MemoryStats.Limit)
	if s.MemoryStats.Limit > 0 {
		out.MemPercent = float64(used) / float64(s.MemoryStats.Limit) * 100
	}

	for _, n := range s.Networks {
		out.NetRxBytes += float64(n.RxBytes)
		out.NetTxBytes += float64(n.TxBytes)
	}
	return out
}

// memUsageNoCache subtracts reclaimable page cache from total memory usage,
// matching `docker stats`. Handles both cgroup v1 (total_inactive_file) and
// cgroup v2 (inactive_file).
func memUsageNoCache(m MemoryStats) uint64 {
	if v, ok := m.Stats["total_inactive_file"]; ok && v < m.Usage {
		return m.Usage - v
	}
	if v, ok := m.Stats["inactive_file"]; ok && v < m.Usage {
		return m.Usage - v
	}
	return m.Usage
}

// Rate returns the per-second change between two cumulative counter readings
// over dt seconds. Negative results (counter reset / container restart) and
// non-positive dt clamp to 0.
func Rate(prev, cur, dtSeconds float64) float64 {
	if dtSeconds <= 0 || cur < prev {
		return 0
	}
	return (cur - prev) / dtSeconds
}

// Metric name constants emitted into the container_metrics table.
const (
	MetricCPUPercent = "cpu_pct"
	MetricMemBytes   = "mem_bytes"
	MetricMemPercent = "mem_pct"
	MetricNetRxBps   = "net_rx_bps"
	MetricNetTxBps   = "net_tx_bps"
)
