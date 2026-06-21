/**
 * End-to-end tests for the metrics PoC. Uses the typed client (same path the
 * browser uses), per AGENTS.md.
 *
 *   - smoke: API is reachable and migrations ran
 *   - writer: row count grows over time
 *   - history: query returns the most recent N points in chronological order
 *   - realtime: subscriber receives a tick within the writer's interval
 *
 * The dev server is auto-started if not already running on :3000.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { installCookieJar, isServerRunning } from '@aws-blocks/blocks/utils';
import type { api as ApiType } from 'aws-blocks';

installCookieJar();

let server: ChildProcess | null = null;
let api: typeof ApiType;

test.before(async () => {
  if (!(await isServerRunning())) {
    server = spawn('npm', ['run', 'dev'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, BLOCKS_DEV_SERVER: 'true' },
    });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      if (await isServerRunning()) {
        ready = true;
        break;
      }
      await setTimeout(500);
    }
    if (!ready) throw new Error('dev server did not start within 15s');
  }
  ({ api } = await import('aws-blocks'));
});

test.after(async () => {
  if (server) {
    server.kill();
    await setTimeout(200);
  }
});

test('smoke: count works (DB + migration applied)', async () => {
  const n = await api.count();
  assert.equal(typeof n, 'number');
  assert.ok(n >= 0, `count should be >= 0, got ${n}`);
});

test('writer: row count grows within 1.5s', async () => {
  const before = await api.count();
  await setTimeout(1500);
  const after = await api.count();
  assert.ok(
    after > before,
    `count should grow from ${before}, got ${after} after 1.5s`,
  );
});

test('history: chronological with all 10 metric keys', async () => {
  await setTimeout(500);
  const hist = await api.getHistory(1);
  assert.ok(hist.length > 0, 'history should be non-empty');
  for (let i = 1; i < hist.length; i++) {
    assert.ok(
      hist[i].t >= hist[i - 1].t,
      `history should be chronological at idx ${i}`,
    );
  }
  const expected = ['cpu', 'memory', 'disk', 'network', 'gpu', 'requests', 'errors', 'latency_p50', 'latency_p99', 'queue'];
  const sample = hist[hist.length - 1];
  for (const key of expected) {
    assert.ok(key in sample.v, `expected metric "${key}" missing`);
    assert.equal(typeof sample.v[key], 'number');
  }
});

test('realtime: subscriber receives at least one tick within 1s', async () => {
  const channel = await api.subscribeMetrics();
  let received = 0;
  let firstTick: any = null;
  const sub = channel.subscribe((msg: any) => {
    received++;
    if (!firstTick) firstTick = msg;
  });
  await sub.established;
  await setTimeout(1000);
  sub.unsubscribe?.();
  assert.ok(received > 0, `expected ≥1 realtime tick in 1s, got ${received}`);
  assert.ok(firstTick?.v?.cpu != null, 'tick should carry cpu value');
});
