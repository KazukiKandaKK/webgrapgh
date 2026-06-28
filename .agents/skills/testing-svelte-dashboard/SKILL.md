---
name: testing-svelte-dashboard
description: E2E test the frontend-svelte observability dashboard (Overview/Metrics/Explore/Logs/Alerts/Settings screens, log filters, alerts, shared worker). Use when verifying frontend-svelte UI changes against the live backend.
---

# Testing the Svelte dashboard (frontend-svelte)

Minimal-dependency Svelte 5 dashboard. Single shared Web Worker streams metrics + logs over WS; uPlot renders; hash router switches screens. No SvelteKit.

## Prerequisites / how to run

The Docker `--profile svelte` image may build/run inconsistently; the most reliable path is a local prod build served by `vite preview` against the live backend:

1. Backend + DB on `:8080` (Go + Postgres). Confirm with `curl -s http://localhost:8080/api/history | head -c 80` and `curl -s http://localhost:8080/api/logs/history | head -c 80`.
2. `cd frontend-svelte && npm run build && npm run preview -- --port 3000` (build runs `svelte-check`; preview serves prod bundle). App at `http://localhost:3000`.
3. Endpoints are read from localStorage settings or env defaults: WS `ws://localhost:8080/ws` (metrics), `ws://localhost:8080/ws/logs` (logs), REST `http://localhost:8080`.

Note: `vite preview` (prod build) is preferred over `npm run dev` because the Docker context bug historically broke `@shared` resolution inside containers — building locally sidesteps it. If `vite preview` ever fails, try `npm run dev` as a fallback.

## Routes
`#/` Overview · `#/metrics` · `#/explore/<metric>` · `#/logs` · `#/alerts` · `#/settings`

## Golden-path tests (record + annotate these)

1. **Explore** — click an Overview KPI card → URL becomes `#/explore/<metric>`, large chart + 5 stat cards (Current/Min/Max/Avg/p95) all finite. Switch the metric dropdown to one with a different unit (e.g. `latency_p99` → `ms`) and confirm chart + stats rescale and URL updates. Proves the swap is real, not static.
2. **Alerts** — `#/alerts` lists default rules (cpu>85, errors>5, latency_p99>500) with live "now" values. To force a firing without waiting, ADD a rule whose threshold is trivially breached (e.g. `CPU > 1`): it fires instantly → red FIRING badge, "Firing now" entry, and **sidebar Alerts nav shows a red count pill** (App-level evaluation, visible on every screen). Delete it to confirm firing + badge clear.
3. **Settings** — `#/settings`. Theme accent buttons recolor the sidebar **live, no reload** (CSS vars). Editing any endpoint field enables the Save button and shows the dirty notice ("未保存の変更があります"); Save reloads the page (rebuilds worker) — avoid clicking it mid-recording. Reset restores env defaults.
4. **Log filters** — `#/logs` shows full virtualized LogTable (30k events). Toggling a level (e.g. ERROR) switches to "Filtered logs" with a `matched / scanned` counter (e.g. 115/1,000); adding source/search text narrows further (combined AND). Clear (クリア) restores the full table.
5. **Shared worker** — navigate across all screens; both stream pills stay `open` and log timestamps keep advancing (no reconnect). Confirms the single App-level worker persists.

## Tips
- Backend log generator produces varied levels (DEBUG/INFO/WARN/ERROR) and sources (api/auth/cache/ingest/queue/scheduler/worker) plus recognizable messages like "auth failed", "connection refused", "panic recovered" — handy stable search terms.
- The page DOM is returned with each computer screenshot; use it to read exact counts/stats/URLs rather than eyeballing.
- Maximize the browser before recording (`wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`).
- Clean up test mutations (delete added alert rules, Reset settings) so localStorage isn't left dirty for the next run.

## Devin Secrets Needed
None — backend is local, no auth.
