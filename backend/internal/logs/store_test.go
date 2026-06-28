package logs

import (
	"testing"
	"time"
)

func TestNewStore_DefaultCapacity(t *testing.T) {
	s := NewStore(0)
	if s.Capacity() != 10000 {
		t.Errorf("Capacity() = %d, want 10000 for zero input", s.Capacity())
	}
	s2 := NewStore(-5)
	if s2.Capacity() != 10000 {
		t.Errorf("Capacity() = %d, want 10000 for negative input", s2.Capacity())
	}
}

func TestNewStore_CustomCapacity(t *testing.T) {
	s := NewStore(100)
	if s.Capacity() != 100 {
		t.Errorf("Capacity() = %d, want 100", s.Capacity())
	}
}

func TestAppend_AssignsID(t *testing.T) {
	s := NewStore(10)
	ev := Event{TimeMs: 1000, Level: "INFO", Source: "test", Message: "hello"}
	stored := s.Append(ev)
	if stored.ID == 0 {
		t.Error("Append should assign a non-zero ID")
	}
	if stored.ID != 1 {
		t.Errorf("first Append ID = %d, want 1", stored.ID)
	}
}

func TestAppend_PreservesExistingID(t *testing.T) {
	s := NewStore(10)
	ev := Event{ID: 99, TimeMs: 1000, Level: "INFO", Source: "test", Message: "hello"}
	stored := s.Append(ev)
	if stored.ID != 99 {
		t.Errorf("Append with existing ID: got %d, want 99", stored.ID)
	}
}

func TestAppend_MonotonicIDs(t *testing.T) {
	s := NewStore(10)
	for i := 0; i < 5; i++ {
		ev := s.Append(Event{TimeMs: int64(i), Level: "INFO", Source: "t", Message: "m"})
		if ev.ID != int64(i+1) {
			t.Errorf("event %d: ID = %d, want %d", i, ev.ID, i+1)
		}
	}
}

func TestSize(t *testing.T) {
	s := NewStore(5)
	if s.Size() != 0 {
		t.Errorf("empty store Size() = %d, want 0", s.Size())
	}
	for i := 0; i < 3; i++ {
		s.Append(Event{TimeMs: int64(i), Level: "INFO", Source: "t", Message: "m"})
	}
	if s.Size() != 3 {
		t.Errorf("after 3 appends Size() = %d, want 3", s.Size())
	}
}

func TestSize_CapsAtCapacity(t *testing.T) {
	s := NewStore(3)
	for i := 0; i < 10; i++ {
		s.Append(Event{TimeMs: int64(i), Level: "INFO", Source: "t", Message: "m"})
	}
	if s.Size() != 3 {
		t.Errorf("overflowed store Size() = %d, want 3 (capacity)", s.Size())
	}
}

func TestSnapshot_ReturnsNewest(t *testing.T) {
	s := NewStore(5)
	for i := 0; i < 5; i++ {
		s.Append(Event{TimeMs: int64(i * 100), Level: "INFO", Source: "t", Message: "m"})
	}
	snap := s.Snapshot(3)
	if len(snap) != 3 {
		t.Fatalf("Snapshot(3) len = %d, want 3", len(snap))
	}
	// Should be the 3 newest in chronological order.
	if snap[0].TimeMs != 200 {
		t.Errorf("snap[0].TimeMs = %d, want 200", snap[0].TimeMs)
	}
	if snap[1].TimeMs != 300 {
		t.Errorf("snap[1].TimeMs = %d, want 300", snap[1].TimeMs)
	}
	if snap[2].TimeMs != 400 {
		t.Errorf("snap[2].TimeMs = %d, want 400", snap[2].TimeMs)
	}
}

func TestSnapshot_AllEvents(t *testing.T) {
	s := NewStore(5)
	for i := 0; i < 3; i++ {
		s.Append(Event{TimeMs: int64(i), Level: "INFO", Source: "t", Message: "m"})
	}
	// limit=0 means all.
	snap := s.Snapshot(0)
	if len(snap) != 3 {
		t.Errorf("Snapshot(0) len = %d, want 3", len(snap))
	}
}

func TestSnapshot_LimitExceedsSize(t *testing.T) {
	s := NewStore(10)
	for i := 0; i < 3; i++ {
		s.Append(Event{TimeMs: int64(i), Level: "INFO", Source: "t", Message: "m"})
	}
	snap := s.Snapshot(100)
	if len(snap) != 3 {
		t.Errorf("Snapshot(100) len = %d, want 3 (clamped to size)", len(snap))
	}
}

func TestSnapshot_RingWrapAround(t *testing.T) {
	s := NewStore(3)
	// Insert 5 events: ring will contain events 3, 4, 5 (by TimeMs).
	for i := 1; i <= 5; i++ {
		s.Append(Event{TimeMs: int64(i * 10), Level: "INFO", Source: "t", Message: "m"})
	}
	snap := s.Snapshot(0)
	if len(snap) != 3 {
		t.Fatalf("Snapshot len = %d, want 3", len(snap))
	}
	// Events should be in chronological order: 30, 40, 50.
	if snap[0].TimeMs != 30 {
		t.Errorf("snap[0].TimeMs = %d, want 30", snap[0].TimeMs)
	}
	if snap[1].TimeMs != 40 {
		t.Errorf("snap[1].TimeMs = %d, want 40", snap[1].TimeMs)
	}
	if snap[2].TimeMs != 50 {
		t.Errorf("snap[2].TimeMs = %d, want 50", snap[2].TimeMs)
	}
}

func TestNewID_Monotonic(t *testing.T) {
	s := NewStore(10)
	prev := s.NewID()
	for i := 0; i < 100; i++ {
		id := s.NewID()
		if id <= prev {
			t.Fatalf("NewID not monotonic: got %d after %d", id, prev)
		}
		prev = id
	}
}

func TestSeedHistory(t *testing.T) {
	s := NewStore(1000)
	SeedHistory(s, 10*time.Minute, 50)
	if s.Size() != 50 {
		t.Errorf("after SeedHistory(50) Size() = %d, want 50", s.Size())
	}
	snap := s.Snapshot(0)
	// Verify chronological order.
	for i := 1; i < len(snap); i++ {
		if snap[i].TimeMs < snap[i-1].TimeMs {
			t.Errorf("events not in order: snap[%d].TimeMs=%d < snap[%d].TimeMs=%d",
				i, snap[i].TimeMs, i-1, snap[i-1].TimeMs)
		}
	}
}

func TestSeedHistory_ZeroCount(t *testing.T) {
	s := NewStore(100)
	SeedHistory(s, time.Minute, 0)
	if s.Size() != 0 {
		t.Errorf("SeedHistory(0) should not insert anything, Size() = %d", s.Size())
	}
}
