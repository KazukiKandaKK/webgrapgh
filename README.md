# webgrapgh

メインスレッドをブロックしないリアルタイム時系列ダッシュボード。

- **Backend**: Go (Echo) + Gorilla WebSocket + PostgreSQL
- **Frontend (既定)**: Svelte 5 + Vite + TailwindCSS + uPlot + Web Worker（ランタイム依存は `uplot` のみ）

## アーキテクチャ

```
┌───────────────────────────────────────────────────────────────┐
│                      Browser (main thread)                    │
│  Svelte / Vite (UIシェルのみ) ──refs──▶ uPlot (Canvas描画)   │
│           ▲ postMessage (描画用配列のみ)                       │
├───────────│───────────────────────────────────────────────────┤
│           │           Web Worker (dataWorker.ts)              │
│  WS受信 → JSONパース → ringバッファ → ダウンサンプル → 通知    │
└───────────│───────────────────────────────────────────────────┘
            │ WebSocket  (1秒に10〜30回)
┌───────────▼───────────────────────────────────────────────────┐
│       Go (Echo) — /api/history (REST) ・ /ws (WebSocket)      │
│       Hub broadcaster ── metrics generator (CPU/Mem/Net/Disk) │
│       └─ PostgreSQL (metrics テーブル)                         │
└───────────────────────────────────────────────────────────────┘
```

設計上の絶対原則:

1. JSONパース・集計・間引きは **Web Worker** で完結。メインスレッドには `Float64Array` のみ渡す。
2. グラフは **uPlot (Canvas)** のみ。SVG / DOM ベースのライブラリは使わない。
3. データ更新でフレームワークの state（`useState` 等）は触らない。`uplot.setData()` を ref 経由で imperative に叩く。
4. フロントエンド（Svelte / Solid / Next）は UI シェル・ルーティングのみ。リアルタイム経路には絡まない。

## フロントエンド実装バリエーション

同一の wire フォーマット（REST `/api/history` + WS `/ws` `/ws/logs`）に対して、複数のフレームワークで等価な UI を実装して比較しています。バックエンドは一切変更不要で差し替えられます。

| ディレクトリ | フレームワーク | ランタイム依存 | 起動 |
|------|------|------|------|
| `frontend-svelte/` | Svelte 5 + Vite | **uplot のみ**（仮想スクロールも自前実装、フレームワークは原則コンパイルで消える） | `docker compose up -d frontend-svelte`（既定） |
| `frontend-solid/` | SolidJS + Vite | solid-js / @tanstack/solid-virtual / uplot | `docker compose --profile solid up -d frontend-solid` |
| `frontend/` | Next.js + React | next / react / react-dom / uplot / yjs ほか | `docker compose --profile next up -d frontend` |

`frontend-svelte` は「依存関係を最小化したチャレンジ」版で、ランタイム依存は描画ライブラリ `uplot` だけ。Svelte コンパイラが UI を素の DOM 操作へ変換するためフレームワーク自体のランタイムが極小になり、ログテーブルの仮想スクロールも外部ライブラリを使わず ~30 行で実装しています。設計上の絶対原則（Worker 完結 / uPlot のみ / `setData` 直叩き / UI シェルのみ）はそのまま踏襲。

既定では `frontend-svelte` がプロファイル無しで起動します。いずれも host 側 :3000 を使うため、別実装に切り替える前に既定の `frontend-svelte` を停止してください:

```bash
docker compose stop frontend-svelte
docker compose --profile next up -d frontend     # Next.js に切り替え
# または
docker compose --profile solid up -d frontend-solid  # SolidJS に切り替え
```

## ディレクトリ構成

```
.
├── docker-compose.yml          # PostgreSQL 16
├── .env.example                # DB 接続情報 / ポート / 配信レート
├── backend/                    # Go (Echo) サーバ
│   ├── cmd/server/main.go
│   ├── cmd/collector/main.go   # コンテナメトリクス収集（Docker daemon）
│   └── internal/
│       ├── config/             # env 読み込み
│       ├── db/                 # 接続・スキーマ・シード
│       ├── dockerstats/        # Docker Engine API クライアント + CPU/mem/net 算出
│       ├── handler/            # /api/history, /api/containers/history, /ws
│       ├── hub/                # WS 接続管理 & ブロードキャスト
│       ├── watcher/            # metrics / container_metrics の LISTEN/NOTIFY
│       └── metrics/            # ダミーメトリクス生成器
├── frontend-svelte/            # Svelte 5 + Vite（既定フロントエンド）
│   └── src/                    # App.svelte / views / components / lib
├── frontend-solid/             # SolidJS + Vite（--profile solid）
├── frontend/                   # Next.js App Router（--profile next）
└── shared/                     # 共有コア（types / dataWorker / bridge）
```

## セットアップ

### 全部 Docker で立ち上げる (推奨)

```bash
cp .env.example .env
docker compose up --build -d
# postgres :5432 / backend :8080 / frontend-svelte :3000
```

- 既定では `frontend-svelte`（依存最小の Svelte 版）が :3000 で起動します。
- 初回起動時に backend が過去 1 時間分のダミーデータ (`SEED_POINTS_PER_METRIC` 件/メトリクス) を PG に投入します。
- ブラウザで `http://localhost:3000` を開くと、履歴 1h を初期描画 → WS 接続 → リアルタイム更新に切り替わります。
- `VITE_*` はビルド時に bundle に焼き込まれるため、ホスト名やポートを変えた場合は `docker compose build frontend-svelte` で再ビルドが必要です。

### 大量データの投入 (bulk seed CLI)

サーバ起動時の auto-seed (`SeedIfEmpty`) は「空のときだけ・直近 1h 分」しか入れません。
それより大量のデータを入れたいときは専用 CLI `seed` を使います。`docker compose` 経由なら:

```bash
# 24h × 100Hz × 4 metric ≒ 34.5M 行をテーブル初期化のうえ投入
docker compose --profile seed run --rm seed --hours 24 --hz 100 --reset

# 既存データを残して 1h × 1000Hz を追加
docker compose --profile seed run --rm seed --hours 1 --hz 1000

# メトリクス指定 + バッチサイズ指定
docker compose --profile seed run --rm seed \
  --metrics cpu,memory --hours 6 --hz 50 --batch 20000 --reset
```

ホスト直接実行:

```bash
cd backend && go run ./cmd/seed --hours 24 --hz 100 --reset
```

主要フラグ:

| flag | default | 説明 |
|------|---------|------|
| `--hours` | 1 | `[now - hours, now]` の範囲に均等配置 |
| `--hz` | 0 | メトリクスあたり毎秒サンプル数。指定すると `--points-per-metric` を上書き |
| `--points-per-metric` | 20000 | hz 指定がない場合のメトリクスあたり総点数 |
| `--metrics` | cpu,memory,network,disk | カンマ区切りで対象を絞り込み |
| `--batch` | 10000 | `COPY` バッチサイズ。大きいほど速いがメモリも食う |
| `--reset` | false | 投入前に `TRUNCATE metrics RESTART IDENTITY` |
| `--quiet` | false | 進捗ログ抑止 |

内部は pgx の `CopyFrom` を使った PostgreSQL COPY なので、ローカル PG で概ね 100k〜500k rows/s 程度で流せます。

### ローカル開発で個別に動かす

PG だけ Docker で立て、backend / frontend はホストで実行:

```bash
docker compose up -d postgres

cd backend && go mod tidy && go run ./cmd/server
# → :8080

cd frontend && npm install && npm run dev
# → :3000
```

## エンドポイント

### `GET /api/history?metrics=cpu,memory,network,disk&minutes=60`

```json
{
  "metrics": {
    "cpu":     { "t": [...unixMs], "v": [...float64] },
    "memory":  { "t": [...],       "v": [...] }
  }
}
```

### `WS /ws`

サーバ → クライアント (バッチ):

```json
{ "t": 1718870000123, "v": { "cpu": 42.1, "memory": 67.3, "network": 12.4, "disk": 88.1 } }
```

### `GET /api/logs/history?limit=10000`

```json
[
  { "id": 1, "t": 1718870000000, "level": "INFO",  "src": "api",  "msg": "request handled in 42ms" },
  { "id": 2, "t": 1718870000050, "level": "ERROR", "src": "auth", "msg": "dial tcp ... connection refused" }
]
```

最大 30,000 件（ストアの ring buffer 容量）。

### `WS /ws/logs`

サーバ → クライアント (1 イベントずつ):

```json
{ "id": 12345, "t": 1718870000123, "level": "WARN", "src": "queue", "msg": "retry 1/3 for job-42" }
```

`LOG_PUSH_HZ` (default 30) で生成頻度を制御。

### コンテナメトリクス（任意の稼働コンテナを計測）

外部 SaaS（Datadog 等）を使わず、このリポジトリ内の `cmd/collector` が Docker
Engine API を `/var/run/docker.sock` 経由で叩いて、**稼働中の全コンテナ**を自動検出し
メトリクスを収集します（標準ライブラリのみ・Docker SDK 依存なし）。算出する指標は
`docker stats` 相当: CPU%（`cpu_delta / system_delta × online_cpus × 100`）、メモリ
使用量/使用率（page cache を除外）、ネットワーク送受信スループット（bytes/s）。

```
cmd/collector  →  container_metrics へ INSERT ; NOTIFY container_metrics_new
watcher        →  LISTEN → 新規行を取得 → /ws/containers へブロードキャスト
frontend       →  Containers 画面（#/containers）でコンテナ別にライブ表示
```

既定の `docker compose up` で `collector` サービスが起動します（ソケットを read-only
でマウント）。収集頻度は `COLLECT_HZ`（default 1）で制御。

#### `GET /api/containers/history?minutes=15&max_points=240`

```json
{
  "containers": ["webgraph-backend", "webgraph-postgres"],
  "series": {
    "webgraph-backend": {
      "cpu_pct":    { "t": [...unixMs], "v": [...float64] },
      "mem_bytes":  { "t": [...],       "v": [...] },
      "net_rx_bps": { "t": [...],       "v": [...] }
    }
  }
}
```

#### `WS /ws/containers`

サーバ → クライアント（同一タイムスタンプの行をまとめて配信）:

```json
{ "t": 1718870000123, "rows": [
  { "c": "webgraph-backend", "m": "cpu_pct", "v": 3.7 },
  { "c": "webgraph-backend", "m": "mem_bytes", "v": 31457280 }
] }
```

## なぜ速いのか

- **JSON.parse をワーカに閉じ込めた** ことでメイン V8 ヒープが汚れず、GC が React 描画を止めない。
- **uPlot は DOM ノードを作らない** ので、点が増えても layout/paint が線形に伸びない。
- **`setData` 直叩き** で React の reconciliation を経由しないため、20Hz 更新でも 60fps を維持しやすい。
- **Worker 内ダウンサンプリング** で、画面のピクセル数を超える点をネットワーク的に持ち込まない。
