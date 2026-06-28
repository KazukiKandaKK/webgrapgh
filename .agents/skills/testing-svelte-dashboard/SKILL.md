---
name: testing-svelte-dashboard
description: E2E test the frontend-svelte observability dashboard (Overview/Metrics/Explore/Logs/Alerts/Settings screens, log filters, alerts, shared worker). Use when verifying frontend-svelte UI changes against the live backend.
---

# Testing the Svelte dashboard (frontend-svelte)

Minimal-dependency Svelte 5 dashboard. Single shared Web Worker streams metrics + logs over WS; uPlot renders; hash router switches screens. No SvelteKit.

## Prerequisites / how to run

`frontend-svelte` is now the **default** compose frontend, so a plain `docker compose up -d --build` (no `--profile`) builds and serves it at `http://localhost:3000` alongside backend/writer/postgres. This is the most realistic path and what end users get.

1. From repo root: `docker compose up -d --build`. Confirm svelte is served: `curl -s localhost:3000 | grep -i '<title>'` → should contain `(Svelte)`.
2. Backend + DB on `:8080`. Confirm with `curl -s http://localhost:8080/api/history | head -c 80` and `curl -s http://localhost:8080/api/logs/history | head -c 80`.
3. Endpoints are read from localStorage settings or env defaults: WS `ws://localhost:8080/ws` (metrics), `ws://localhost:8080/ws/logs` (logs), REST `http://localhost:8080`.

Alternative (faster iteration / if a Docker build misbehaves): local prod build via `cd frontend-svelte && npm run build && npm run preview -- --port 3000` (build runs `svelte-check`). `npm run dev` is a further fallback. The historical `@shared` Docker-context bug was fixed (build context is repo root), so the Docker path should now work.

### Testing a compose default-profile change
When the change is "make service X the default" (profile assignment swap):
- Verify statically: `docker compose config --services` (default) vs `docker compose --profile <name> config --services`.
- Verify at runtime by actually bringing the stack up and checking *which UI is served* (e.g. page `<title>` / a unique build marker like "SVELTE EDITION"), not just the config list.
- **Gotcha:** `docker compose down` does NOT remove containers for profile-gated services, so a stale exited container from an old default can survive and confuse `docker ps -a`. Remove it explicitly (`docker rm <name>`) and re-run the default `up` to prove it isn't recreated. Distinguish "Up Ns" (freshly started) from "Exited … minutes ago" (leftover).

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
