CREATE TABLE IF NOT EXISTS metrics (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ      NOT NULL,
    metric_name TEXT             NOT NULL,
    value       DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_name_ts
    ON metrics (metric_name, ts DESC);

-- Per-container metrics collected from the Docker daemon by cmd/collector.
-- Dimensioned by (container, metric) so arbitrary, dynamically-discovered
-- containers can be tracked independently of the fixed `metrics` set above.
CREATE TABLE IF NOT EXISTS container_metrics (
    id        BIGSERIAL        PRIMARY KEY,
    ts        TIMESTAMPTZ      NOT NULL,
    container TEXT             NOT NULL,
    metric    TEXT             NOT NULL,
    value     DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_container_metrics_ts
    ON container_metrics (ts DESC);

CREATE INDEX IF NOT EXISTS idx_container_metrics_key_ts
    ON container_metrics (container, metric, ts DESC);

CREATE INDEX IF NOT EXISTS idx_container_metrics_ts_asc
    ON container_metrics (ts ASC);

-- Snapshots store a named point-in-time capture of one or more metric series.
CREATE TABLE IF NOT EXISTS snapshots (
    id            BIGSERIAL    PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    metric_names  JSONB        NOT NULL,
    series_data   JSONB        NOT NULL,
    range_minutes INT          NOT NULL DEFAULT 60,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Comments are threaded notes attached to a snapshot.
CREATE TABLE IF NOT EXISTS snapshot_comments (
    id          BIGSERIAL    PRIMARY KEY,
    snapshot_id BIGINT       NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    author      VARCHAR(255) NOT NULL DEFAULT 'anonymous',
    body        TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_comments_snapshot_ts
    ON snapshot_comments (snapshot_id, created_at ASC);
