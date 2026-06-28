# webgrapgh

メインスレッドをブロックしないリアルタイム時系列ダッシュボード。

- **Backend**: Go (Echo) + Gorilla WebSocket + PostgreSQL
- **Frontend**: Next.js (App Router) + React + TailwindCSS + uPlot + Web Worker

## アーキテクチャ

```
┌───────────────────────────────────────────────────────────────┐
│                      Browser (main thread)                    │
│  Next.js / React (UIシェルのみ) ──refs──▶ uPlot (Canvas描画)  │
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
3. データ更新で `useState` は呼ばない。`uplot.setData()` を ref 経由で imperative に叩く。
4. Next.js は UI シェル・ルーティング・SSR のみ。リアルタイム経路には絡まない。

## フロントエンド実装バリエーション

同一の wire フォーマット（REST `/api/history` + WS `/ws` `/ws/logs`）に対して、複数のフレームワークで等価な UI を実装して比較しています。バックエンドは一切変更不要で差し替えられます。

| ディレクトリ | フレームワーク | ランタイム依存 | 起動 |
|------|------|------|------|
| `frontend/` | Next.js + React | next / react / react-dom / uplot / yjs ほか | `docker compose up -d frontend`（既定） |
| `frontend-solid/` | SolidJS + Vite | solid-js / @tanstack/solid-virtual / uplot | `docker compose --profile solid up -d frontend-solid` |
| `frontend-svelte/` | Svelte 5 + Vite | **uplot のみ**（仮想スクロールも自前実装、フレームワークは原則コンパイルで消える） | `docker compose --profile svelte up -d frontend-svelte` |

`frontend-svelte` は「依存関係を最小化したチャレンジ」版で、ランタイム依存は描画ライブラリ `uplot` だけ。Svelte コンパイラが UI を素の DOM 操作へ変換するためフレームワーク自体のランタイムが極小になり、ログテーブルの仮想スクロールも外部ライブラリを使わず ~30 行で実装しています。設計上の絶対原則（Worker 完結 / uPlot のみ / `setData` 直叩き / UI シェルのみ）はそのまま踏襲。

いずれも host 側 :3000 を使うため、別実装に切り替える前に既定の `frontend` を停止してください:

```bash
docker compose stop frontend
docker compose --profile svelte up -d frontend-svelte
```

## ディレクトリ構成

```
.
├── docker-compose.yml          # PostgreSQL 16
├── .env.example                # DB 接続情報 / ポート / 配信レート
├── backend/                    # Go (Echo) サーバ
│   ├── cmd/server/main.go
│   └── internal/
│       ├── config/             # env 読み込み
│       ├── db/                 # 接続・スキーマ・シード
│       ├── handler/            # /api/history, /ws
│       ├── hub/                # WS 接続管理 & ブロードキャスト
│       └── metrics/            # ダミーメトリクス生成器
└── frontend/                   # Next.js (App Router)
    ├── app/                    # layout / page / globals
    ├── components/             # UplotChart, DashboardGrid, Sidebar
    ├── lib/                    # workerBridge, types
    └── workers/dataWorker.ts   # WS + パース + ダウンサンプル
```

## セットアップ

### 全部 Docker で立ち上げる (推奨)

```bash
cp .env.example .env
docker compose up --build -d
# postgres :5432 / backend :8080 / frontend :3000
```

- 初回起動時に backend が過去 1 時間分のダミーデータ (`SEED_POINTS_PER_METRIC` 件/メトリクス) を PG に投入します。
- ブラウザで `http://localhost:3000` を開くと、履歴 1h を初期描画 → WS 接続 → リアルタイム更新に切り替わります。
- `NEXT_PUBLIC_*` はビルド時に bundle に焼き込まれるため、ホスト名やポートを変えた場合は `docker compose build frontend` で再ビルドが必要です。

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

## なぜ速いのか

- **JSON.parse をワーカに閉じ込めた** ことでメイン V8 ヒープが汚れず、GC が React 描画を止めない。
- **uPlot は DOM ノードを作らない** ので、点が増えても layout/paint が線形に伸びない。
- **`setData` 直叩き** で React の reconciliation を経由しないため、20Hz 更新でも 60fps を維持しやすい。
- **Worker 内ダウンサンプリング** で、画面のピクセル数を超える点をネットワーク的に持ち込まない。
