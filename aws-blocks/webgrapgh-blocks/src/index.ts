/**
 * Frontend — src/index.ts
 *
 * Minimal demo: shows the latest Tick from the Blocks Realtime channel and
 * the row count from the Blocks Database. Auth is intentionally disabled in
 * this PoC since the backend exposes no per-user data.
 */
import { api } from 'aws-blocks';
import { html, render } from 'lit-html';

type Tick = { t: number; v: Record<string, number> };

const METRIC_NAMES = [
  'cpu', 'memory', 'disk', 'network',
  'gpu', 'requests', 'errors',
  'latency_p50', 'latency_p99', 'queue',
];

const root = document.getElementById('app')!;
let latest: Tick | null = null;
let count = 0;
let history: Tick[] = [];

function redraw() {
  const ts = latest ? new Date(latest.t).toISOString().slice(11, 23) : '—';
  render(
    html`
      <h1 style="font-family:system-ui;margin:0 0 4px">webgrapgh — AWS Blocks PoC</h1>
      <p style="color:#666;margin:0 0 16px;font-size:0.9em">
        Database + Realtime + ApiNamespace, fully local via PGlite.
        Stored ticks: <strong>${count}</strong>. History rows fetched: ${history.length}.
      </p>
      <h2 style="margin:8px 0;font-size:1em">Latest tick <code style="font-size:0.85em">${ts}</code></h2>
      <table style="border-collapse:collapse;font-family:ui-monospace,monospace;font-size:0.9em">
        ${METRIC_NAMES.map((name) => {
          const v = latest?.v?.[name];
          return html`
            <tr>
              <td style="padding:4px 12px 4px 0;color:#888">${name}</td>
              <td style="padding:4px 0;text-align:right">${v != null ? v.toFixed(2) : '—'}</td>
            </tr>
          `;
        })}
      </table>
    `,
    root,
  );
}

async function loadInitial() {
  try {
    history = await api.getHistory(5);
    count = await api.count();
    if (history.length > 0) latest = history[history.length - 1];
    redraw();
  } catch (err) {
    console.error('[ui] initial load failed:', err);
  }
}

async function startRealtime() {
  try {
    const channel = await api.subscribeMetrics();
    const sub = channel.subscribe((msg: Tick) => {
      latest = msg;
      count += 1;
      redraw();
    });
    await sub.established;
    console.info('[ui] realtime subscribed');
  } catch (err) {
    console.error('[ui] realtime failed:', err);
  }
}

redraw();
loadInitial().then(startRealtime);
