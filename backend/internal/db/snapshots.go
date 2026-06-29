package db

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MetricSeries holds a paired timestamp/value array for one metric.
type MetricSeries struct {
	T []int64   `json:"t"`
	V []float64 `json:"v"`
}

// Snapshot is a named point-in-time capture of metric series data.
type Snapshot struct {
	ID           int64                     `json:"id"`
	Name         string                    `json:"name"`
	MetricNames  []string                  `json:"metric_names"`
	SeriesData   map[string]MetricSeries   `json:"series_data"`
	RangeMinutes int                       `json:"range_minutes"`
	CreatedAt    time.Time                 `json:"created_at"`
	CommentCount int                       `json:"comment_count"`
}

// SnapshotSummary is a lightweight Snapshot without series_data for list views.
type SnapshotSummary struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	MetricNames  []string  `json:"metric_names"`
	RangeMinutes int       `json:"range_minutes"`
	CreatedAt    time.Time `json:"created_at"`
	CommentCount int       `json:"comment_count"`
}

// Comment is a threaded note attached to a snapshot.
type Comment struct {
	ID         int64     `json:"id"`
	SnapshotID int64     `json:"snapshot_id"`
	Author     string    `json:"author"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

// CommentPage is a paginated list of comments with total count.
type CommentPage struct {
	Comments []Comment `json:"comments"`
	Total    int       `json:"total"`
	HasMore  bool      `json:"has_more"`
}

// WSCommentEvent is the payload broadcast over /ws/snapshots when a comment is added.
type WSCommentEvent struct {
	SnapshotID int64   `json:"snapshot_id"`
	Comment    Comment `json:"comment"`
}

// CreateSnapshotRequest is the input for CreateSnapshot.
type CreateSnapshotRequest struct {
	Name         string                  `json:"name"`
	MetricNames  []string                `json:"metric_names"`
	SeriesData   map[string]MetricSeries `json:"series_data"`
	RangeMinutes int                     `json:"range_minutes"`
}

// CreateCommentRequest is the input for CreateComment.
type CreateCommentRequest struct {
	Author string `json:"author"`
	Body   string `json:"body"`
}

// CreateSnapshot inserts a new snapshot and returns it with its assigned ID.
func CreateSnapshot(ctx context.Context, pool *pgxpool.Pool, req CreateSnapshotRequest) (Snapshot, error) {
	metricNamesJSON, err := json.Marshal(req.MetricNames)
	if err != nil {
		return Snapshot{}, err
	}
	seriesDataJSON, err := json.Marshal(req.SeriesData)
	if err != nil {
		return Snapshot{}, err
	}

	var s Snapshot
	err = pool.QueryRow(ctx,
		`INSERT INTO snapshots (name, metric_names, series_data, range_minutes)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, metric_names, series_data, range_minutes, created_at`,
		req.Name, metricNamesJSON, seriesDataJSON, req.RangeMinutes,
	).Scan(&s.ID, &s.Name, &metricNamesJSON, &seriesDataJSON, &s.RangeMinutes, &s.CreatedAt)
	if err != nil {
		return Snapshot{}, err
	}

	if err := json.Unmarshal(metricNamesJSON, &s.MetricNames); err != nil {
		return Snapshot{}, err
	}
	if err := json.Unmarshal(seriesDataJSON, &s.SeriesData); err != nil {
		return Snapshot{}, err
	}
	return s, nil
}

// ListSnapshots returns up to limit snapshots ordered by creation time descending.
func ListSnapshots(ctx context.Context, pool *pgxpool.Pool, limit int) ([]SnapshotSummary, error) {
	rows, err := pool.Query(ctx,
		`SELECT s.id, s.name, s.metric_names, s.range_minutes, s.created_at,
		        COUNT(c.id) AS comment_count
		 FROM snapshots s
		 LEFT JOIN snapshot_comments c ON c.snapshot_id = s.id
		 GROUP BY s.id
		 ORDER BY s.created_at DESC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SnapshotSummary
	for rows.Next() {
		var s SnapshotSummary
		var metricNamesJSON []byte
		if err := rows.Scan(&s.ID, &s.Name, &metricNamesJSON, &s.RangeMinutes, &s.CreatedAt, &s.CommentCount); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(metricNamesJSON, &s.MetricNames); err != nil {
			return nil, err
		}
		results = append(results, s)
	}
	return results, rows.Err()
}

// GetSnapshot returns the snapshot with the given id, or nil if not found.
func GetSnapshot(ctx context.Context, pool *pgxpool.Pool, id int64) (*Snapshot, error) {
	var s Snapshot
	var metricNamesJSON, seriesDataJSON []byte
	err := pool.QueryRow(ctx,
		`SELECT id, name, metric_names, series_data, range_minutes, created_at
		 FROM snapshots WHERE id = $1`,
		id,
	).Scan(&s.ID, &s.Name, &metricNamesJSON, &seriesDataJSON, &s.RangeMinutes, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(metricNamesJSON, &s.MetricNames); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(seriesDataJSON, &s.SeriesData); err != nil {
		return nil, err
	}
	return &s, nil
}

// DeleteSnapshot removes the snapshot and its comments. Returns false if not found.
func DeleteSnapshot(ctx context.Context, pool *pgxpool.Pool, id int64) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM snapshots WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// CreateComment inserts a comment on a snapshot and returns it with its assigned ID.
func CreateComment(ctx context.Context, pool *pgxpool.Pool, snapshotID int64, author, body string) (Comment, error) {
	var c Comment
	err := pool.QueryRow(ctx,
		`INSERT INTO snapshot_comments (snapshot_id, author, body)
		 VALUES ($1, $2, $3)
		 RETURNING id, snapshot_id, author, body, created_at`,
		snapshotID, author, body,
	).Scan(&c.ID, &c.SnapshotID, &c.Author, &c.Body, &c.CreatedAt)
	return c, err
}

// ListComments returns paginated comments for a snapshot, newest first.
func ListComments(ctx context.Context, pool *pgxpool.Pool, snapshotID int64, limit, offset int) (CommentPage, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, snapshot_id, author, body, created_at
		 FROM snapshot_comments
		 WHERE snapshot_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		snapshotID, limit, offset,
	)
	if err != nil {
		return CommentPage{}, err
	}
	defer rows.Close()

	var comments []Comment
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.SnapshotID, &c.Author, &c.Body, &c.CreatedAt); err != nil {
			return CommentPage{}, err
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return CommentPage{}, err
	}

	var total int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM snapshot_comments WHERE snapshot_id = $1`, snapshotID,
	).Scan(&total); err != nil {
		return CommentPage{}, err
	}

	if comments == nil {
		comments = []Comment{}
	}
	return CommentPage{
		Comments: comments,
		Total:    total,
		HasMore:  offset+len(comments) < total,
	}, nil
}
