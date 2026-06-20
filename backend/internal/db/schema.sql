CREATE TABLE IF NOT EXISTS metrics (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ      NOT NULL,
    metric_name TEXT             NOT NULL,
    value       DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_name_ts
    ON metrics (metric_name, ts DESC);
