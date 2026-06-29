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
