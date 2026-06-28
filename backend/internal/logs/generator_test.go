package logs

import (
	"strings"
	"testing"
	"time"
)

func TestGenerator_Next_Fields(t *testing.T) {
	g := NewGenerator()
	now := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)
	ev := g.Next(now)

	if ev.TimeMs != now.UnixMilli() {
		t.Errorf("TimeMs = %d, want %d", ev.TimeMs, now.UnixMilli())
	}
	if ev.ID != 0 {
		t.Errorf("ID = %d, want 0 (unassigned)", ev.ID)
	}
	if ev.Level == "" {
		t.Error("Level is empty")
	}
	if ev.Source == "" {
		t.Error("Source is empty")
	}
	if ev.Message == "" {
		t.Error("Message is empty")
	}
}

func TestGenerator_Next_ValidLevels(t *testing.T) {
	g := NewGenerator()
	validLevels := map[string]bool{"INFO": true, "WARN": true, "ERROR": true, "DEBUG": true}
	now := time.Now()
	for i := 0; i < 100; i++ {
		ev := g.Next(now)
		if !validLevels[ev.Level] {
			t.Errorf("unexpected level %q", ev.Level)
		}
	}
}

func TestGenerator_Next_ValidSources(t *testing.T) {
	g := NewGenerator()
	validSources := map[string]bool{
		"api": true, "auth": true, "scheduler": true,
		"cache": true, "queue": true, "ingest": true, "worker": true,
	}
	now := time.Now()
	for i := 0; i < 100; i++ {
		ev := g.Next(now)
		if !validSources[ev.Source] {
			t.Errorf("unexpected source %q", ev.Source)
		}
	}
}

func TestGenerator_Next_ErrorMessages(t *testing.T) {
	g := NewGenerator()
	now := time.Now()
	// Generate enough events to get some errors.
	errorMsgs := []string{}
	for i := 0; i < 500; i++ {
		ev := g.Next(now)
		if ev.Level == "ERROR" {
			errorMsgs = append(errorMsgs, ev.Message)
		}
	}
	if len(errorMsgs) == 0 {
		t.Fatal("expected at least one ERROR event in 500 iterations")
	}
	// Verify error messages match expected patterns.
	for _, msg := range errorMsgs {
		if !strings.Contains(msg, "dial tcp") &&
			!strings.Contains(msg, "panic recovered") &&
			!strings.Contains(msg, "upstream timeout") &&
			!strings.Contains(msg, "auth failed") {
			t.Errorf("unexpected ERROR message pattern: %q", msg)
		}
	}
}

func TestGenerator_Next_WarnMessages(t *testing.T) {
	g := NewGenerator()
	now := time.Now()
	warnMsgs := []string{}
	for i := 0; i < 500; i++ {
		ev := g.Next(now)
		if ev.Level == "WARN" {
			warnMsgs = append(warnMsgs, ev.Message)
		}
	}
	if len(warnMsgs) == 0 {
		t.Fatal("expected at least one WARN event in 500 iterations")
	}
	for _, msg := range warnMsgs {
		if !strings.Contains(msg, "slow query") &&
			!strings.Contains(msg, "retry") &&
			!strings.Contains(msg, "rate limit") {
			t.Errorf("unexpected WARN message pattern: %q", msg)
		}
	}
}

func TestGenerator_Next_DebugMessages(t *testing.T) {
	g := NewGenerator()
	now := time.Now()
	debugMsgs := []string{}
	for i := 0; i < 500; i++ {
		ev := g.Next(now)
		if ev.Level == "DEBUG" {
			debugMsgs = append(debugMsgs, ev.Message)
		}
	}
	if len(debugMsgs) == 0 {
		t.Fatal("expected at least one DEBUG event in 500 iterations")
	}
	for _, msg := range debugMsgs {
		if !strings.Contains(msg, "trace span=") {
			t.Errorf("unexpected DEBUG message pattern: %q", msg)
		}
	}
}
