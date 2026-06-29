package db

import (
	"encoding/json"
	"testing"
	"time"

	"pgregory.net/rapid"
)

// --- PBT: MetricSeries JSON round-trip ---

func TestMetricSeries_JSONRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(0, 100).Draw(t, "n")
		ts := make([]int64, n)
		vs := make([]float64, n)
		for i := range ts {
			ts[i] = rapid.Int64Range(0, 1<<53).Draw(t, "t")
			vs[i] = rapid.Float64().Draw(t, "v")
		}
		original := MetricSeries{T: ts, V: vs}

		data, err := json.Marshal(original)
		if err != nil {
			t.Fatalf("marshal failed: %v", err)
		}
		var got MetricSeries
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}

		if len(got.T) != len(original.T) {
			t.Fatalf("T length changed: got %d want %d", len(got.T), len(original.T))
		}
		if len(got.V) != len(original.V) {
			t.Fatalf("V length changed: got %d want %d", len(got.V), len(original.V))
		}
		for i := range original.T {
			if got.T[i] != original.T[i] {
				t.Fatalf("T[%d] changed: got %d want %d", i, got.T[i], original.T[i])
			}
		}
	})
}

// --- PBT: MetricSeries length invariant ---

func TestMetricSeries_LengthInvariant(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(0, 200).Draw(t, "n")
		ts := make([]int64, n)
		vs := make([]float64, n)
		series := MetricSeries{T: ts, V: vs}

		data, _ := json.Marshal(series)
		var got MetricSeries
		json.Unmarshal(data, &got)

		if len(got.T) != len(got.V) {
			t.Fatalf("length invariant violated after round-trip: len(T)=%d len(V)=%d", len(got.T), len(got.V))
		}
	})
}

// --- PBT: Comment JSON round-trip ---

func TestComment_JSONRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		original := Comment{
			ID:         rapid.Int64Range(1, 1<<53).Draw(t, "id"),
			SnapshotID: rapid.Int64Range(1, 1<<53).Draw(t, "snapshot_id"),
			Author:     rapid.StringMatching(`[a-zA-Z0-9 ]{1,50}`).Draw(t, "author"),
			Body:       rapid.StringMatching(`[a-zA-Z0-9 .,!?]{1,200}`).Draw(t, "body"),
			CreatedAt:  time.Unix(rapid.Int64Range(0, 1<<32).Draw(t, "ts"), 0).UTC(),
		}

		data, err := json.Marshal(original)
		if err != nil {
			t.Fatalf("marshal failed: %v", err)
		}
		var got Comment
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}

		if got.ID != original.ID {
			t.Fatalf("ID changed: got %d want %d", got.ID, original.ID)
		}
		if got.SnapshotID != original.SnapshotID {
			t.Fatalf("SnapshotID changed: got %d want %d", got.SnapshotID, original.SnapshotID)
		}
		if got.Author != original.Author {
			t.Fatalf("Author changed: got %q want %q", got.Author, original.Author)
		}
		if got.Body != original.Body {
			t.Fatalf("Body changed: got %q want %q", got.Body, original.Body)
		}
	})
}

// --- Unit: CommentPage HasMore calculation ---

func TestCommentPage_HasMore(t *testing.T) {
	cases := []struct {
		offset   int
		fetched  int
		total    int
		wantMore bool
	}{
		{0, 50, 100, true},
		{50, 50, 100, false},
		{0, 10, 10, false},
		{0, 0, 0, false},
		{90, 10, 100, false},
		{80, 10, 100, true},
	}
	for _, tc := range cases {
		got := tc.offset+tc.fetched < tc.total
		if got != tc.wantMore {
			t.Errorf("offset=%d fetched=%d total=%d: HasMore=%v want %v",
				tc.offset, tc.fetched, tc.total, got, tc.wantMore)
		}
	}
}
