# aws-blocks

[AWS Blocks](https://aws.amazon.com/products/developer-tools/blocks/) で書き直した webgrapgh の PoC。

> Build local full-stack apps in seconds, deploy to AWS when ready

ローカルでは **PGlite (in-process Postgres) + 内蔵 Realtime ハブ + 型付き RPC** が
ゼロ設定で動き、AWS デプロイ時は同じコードがそのまま **Aurora Serverless v2 +
AppSync/IoT Realtime + Lambda** に変わる、という構造の検証。

## 構成

```
aws-blocks/webgrapgh-blocks/
├── aws-blocks/
│   ├── index.ts                # Backend: Database + Realtime + ApiNamespace
│   ├── index.cdk.ts            # 生成される CDK stack (Hosting + Lambda)
│   ├── index.handler.ts        # Lambda エントリ
│   └── migrations/
│       └── 001_create_metrics.sql
├── src/index.ts                # Frontend (lit-html, 既存 Next.js とは別物)
├── test/e2e.test.ts            # 型付き client で API を叩く E2E
└── package.json                # scripts: dev / sandbox / deploy / destroy
```

## 起動 (zero config)

```bash
cd webgrapgh-blocks
npm install
npm run dev
# → backend: http://localhost:3000  (RPC + Realtime WS)
# → frontend: http://localhost:3100
```

`.bb-data/` 配下に PGlite のデータベースファイルが作られて、マイグレーションが
自動適用される。起動ログにこう出る:

```
[migrations] Applied: 001_create_metrics.sql
[writer] dev-mode interval started @ 10Hz
```

## 設計上のメモ

### Writer (=ティック生成)

10Hz の `setInterval` を `aws-blocks/index.ts` のモジュールロード時に仕掛けている。
これは **ローカルの `npm run dev`(単一 Node プロセス) 専用**。AWS Lambda は handler
ごとに起動/破棄されるので setInterval は維持できない。

→ プロダクション化するなら:
- `bb-cron-job` (EventBridge Scheduler、最小 `rate(1 minute)`)、または
- 既存の Go writer をそのまま ECS Fargate で常駐させて、Blocks の `Database` の
  外側から INSERT する。Blocks 側は読みと realtime publish だけに専念。

### モジュール一覧 (this PoC で使ったもの)

| Block | 用途 | local | AWS |
|---|---|---|---|
| `bb-data` `Database` | metrics テーブル | PGlite (`.bb-data/`) | Aurora Serverless v2 |
| `Realtime` | metrics チャネル pub/sub | in-process WS | AppSync subscriptions |
| `ApiNamespace` | `getHistory` / `count` / `subscribeMetrics` | dev サーバー上の RPC ハンドラ | Lambda + API Gateway |

利用可能な他の Block は `node_modules/@aws-blocks/blocks/docs/` 配下に Markdown
で揃っている (auth-basic / auth-cognito / file-bucket / async-job / cron-job /
agent / knowledge-base / kv-store / metrics / tracer / dashboard 等)。

## 既存リポジトリとの関係

| | 既存 (`../backend`) | microservices (`../aws-microservices`) | **このスタック** |
|---|---|---|---|
| 言語 | Go | Go (gRPC) + TS (CDK) | TypeScript |
| 通信 | WS (Echo) | gRPC + WS | RPC + WS (自動生成 client) |
| DB | Postgres コンテナ | (各サービス in-memory) | PGlite ローカル / Aurora デプロイ |
| ローカル完結 | △ (compose 必須) | △ (compose + LocalStack 不完全) | ◎ (`npm install && npm run dev` だけ) |
| AWS デプロイ | 自前 ECR + CDK | CDK で ECS Fargate | `npm run sandbox` 一発 |

「**ローカルで `cdk deploy` が要らない**」のが Blocks の一番の差別化ポイント。

## E2E テスト

```bash
npm run test:e2e
# 1. dev サーバーが上がっていれば再利用、上がってなければ自動 spawn
# 2. 型付き client で api.count / api.getHistory / api.subscribeMetrics を実行
# 3. すべて pass で exit 0
```

## デプロイ (要 AWS credentials)

```bash
npm run sandbox          # 個人向けスタックを AWS に
npm run sandbox:destroy  # 後片付け
npm run deploy           # 本番スタックを AWS に
```

これらが内部で生成する CloudFormation は `aws-blocks/index.cdk.ts` 経由で
`BlocksStack.create()` が組む — つまり **Blocks は CDK の上に立つレイヤ**
(置き換えではなく抽象化)。
