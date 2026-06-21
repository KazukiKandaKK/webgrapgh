/**
 * Backend — aws-blocks/index.ts (webgrapgh PoC)
 *
 * Demonstrates running the realtime-metrics use case entirely locally via
 * AWS Blocks. Composes 3 Blocks:
 *   - Database (bb-data)  : Postgres (PGlite locally, Aurora Serverless on AWS)
 *   - Realtime            : pub/sub channel for new ticks
 *   - ApiNamespace        : typed RPC (getHistory + subscribeMetrics)
 *
 * Local "writer": a setInterval scheduled at module load. This works for
 * `npm run dev` (the dev server is one Node process), but does NOT survive
 * deployment to AWS Lambda (handlers are cold/ephemeral). For production
 * replace with either a CronJob (≥1 min granularity) or a long-running
 * ECS Fargate container — see ../README.md.
 */
import { ApiNamespace, Scope, Realtime } from '@aws-blocks/blocks';
import { Database, sql } from '@aws-blocks/bb-data';
import { z } from 'zod';

const scope = new Scope('webgrapgh');

// ─── Postgres (PGlite locally, Aurora Serverless v2 on AWS) ─────────────────
const db = new Database(scope, 'main', {
  migrationsPath: './aws-blocks/migrations',
});

// ─── Realtime pub/sub: one channel, all subscribers ─────────────────────────
const rt = new Realtime(scope, 'live', {
  namespaces: {
    metrics: Realtime.namespace(
      z.object({
        t: z.number(),
        v: z.record(z.string(), z.number()),
      }),
    ),
  },
});

// ─── Domain shape (mirror of the existing Go service) ──────────────────────
const METRIC_NAMES = [
  'cpu', 'memory', 'disk', 'network',
  'gpu', 'requests', 'errors',
  'latency_p50', 'latency_p99', 'queue',
] as const;
type MetricName = (typeof METRIC_NAMES)[number];

function shape(name: MetricName): [number, number, number] {
  switch (name) {
    case 'cpu': return [45, 25, 180];
    case 'memory': return [62, 8, 600];
    case 'disk': return [70, 5, 1200];
    case 'gpu': return [50, 30, 240];
    case 'network': return [30, 28, 90];
    case 'requests': return [120, 60, 75];
    case 'errors': return [1.5, 1.4, 200];
    case 'latency_p50': return [50, 30, 120];
    case 'latency_p99': return [250, 150, 300];
    case 'queue': return [400, 350, 480];
  }
}

function generateTick(): { t: number; v: Record<MetricName, number> } {
  const now = Date.now();
  const t = now / 1000;
  const v = {} as Record<MetricName, number>;
  for (const name of METRIC_NAMES) {
    const [base, amp, period] = shape(name);
    const x = t / period;
    const noise = (Math.random() - 0.5) * amp * 0.5;
    v[name] = Math.max(0, base + amp * Math.sin(x * 2 * Math.PI) + noise);
  }
  return { t: now, v };
}

// ─── API (typed RPC; the frontend imports `api` and calls these directly) ──
export const api = new ApiNamespace(scope, 'api', () => ({
  /** Subscribe to the realtime metrics channel. Frontend: `await api.subscribeMetrics()`. */
  async subscribeMetrics() {
    return rt.getChannel('metrics', 'all');
  },

  /** Last `minutes` of history, oldest first. */
  async getHistory(minutes: number = 5) {
    const rows = await db.query<{ t_ms: number; values_json: Record<string, number> }>(
      sql`
        SELECT
          CAST(extract(epoch FROM ts) * 1000 AS bigint) AS t_ms,
          values_json
        FROM metrics
        WHERE ts >= now() - (${minutes}::text || ' minutes')::interval
        ORDER BY ts ASC
      `,
    );
    return rows.map(r => ({ t: Number(r.t_ms), v: r.values_json }));
  },

  /** Number of stored ticks (sanity check). */
  async count() {
    const rows = await db.query<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM metrics`);
    return rows[0]?.n ?? 0;
  },
}));

// ─── Local "writer" — single-process setInterval at module load ────────────
// Runs ONLY in `npm run dev`. The Lambda handler in AWS doesn't keep an
// interval alive across invocations; for prod use CronJob or ECS.
let writerStarted = false;
function startWriter() {
  if (writerStarted) return;
  writerStarted = true;
  const interval = 100; // 10 Hz — fast enough to look "real" without flooding PGlite
  setInterval(async () => {
    try {
      const tick = generateTick();
      await db.execute(sql`
        INSERT INTO metrics (ts, values_json)
        VALUES (to_timestamp(${tick.t / 1000}), ${JSON.stringify(tick.v)}::jsonb)
      `);
      await rt.publish('metrics', 'all', tick);
    } catch (err) {
      console.error('[writer] tick failed:', err);
    }
  }, interval);
  console.log(`[writer] dev-mode interval started @ ${1000 / interval}Hz`);
}
// Only run in the dev process — module is also imported during CDK synth
// where DB/Realtime aren't connected.
if (process.env.BLOCKS_DEV_SERVER === 'true' || process.env.NODE_ENV !== 'production') {
  // Defer slightly so migrations run before the first write.
  setTimeout(startWriter, 500);
}
