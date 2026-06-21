-- Single fat-row metrics table. `values_json` keeps all 10 metric values for a
-- given tick in one row, matching the existing browser wire format
-- {t: ms, v: {cpu, memory, ...}} so the UI can render without remapping.
CREATE TABLE metrics (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  values_json JSONB       NOT NULL
);

CREATE INDEX idx_metrics_ts ON metrics (ts DESC);
