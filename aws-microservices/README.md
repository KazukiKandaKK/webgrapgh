# aws-microservices

既存モノリスを AWS マイクロサービス構成に分解した代替実装。フロントエンドは
未変更で `http://localhost:8080` を指したまま、裏側だけ swap できる。

```
[browser] ──WS/REST──> [BFF :8080] ──gRPC──┬──> [metrics :50051]
                                            └──> [logs    :50052]
                              ↑
                          ALB (本番のみ)
```

## クイックスタート (Docker)

```bash
# モノリスを止めておく (port 8080 / 3000 が衝突するため)
cd .. && docker compose down

cd aws-microservices
docker compose up --build -d
# localstack :4566 / metrics :50051 / logs :50052 / bff :8080 / frontend :3000
```

`http://localhost:3000` を開けば、既存フロントが BFF 経由でデータを受信する。
通信内容のワイヤフォーマットはモノリスと完全一致 (`{t, v:{...}}` / `{id, t, level, src, msg}`)。

## 構成

```
aws-microservices/
├── proto/                          # Protocol Buffers (中央定義)
│   ├── metrics/metrics.proto       # MetricsService: StreamRealtime / GetHistory
│   └── logs/logs.proto             # LogService:     StreamRealtime / GetHistory
├── services/
│   ├── bff/                        # WS/REST → gRPC translator (port 8080)
│   ├── metrics/                    # gRPC server + 擬似ジェネレータ (port 50051)
│   └── logs/                       # gRPC server + 擬似ログ生成器 (port 50052)
├── cdk/                            # AWS CDK (TypeScript)
│   ├── lib/{vpc,alb,ecs}-stack.ts
│   └── bin/app.ts
├── scripts/gen-proto.sh            # protoc を Docker 経由で実行
├── Dockerfile                       # 3 services を single multi-target build
└── docker-compose.yml              # localstack + 3 services + frontend
```

## proto 再生成

`.proto` を変更したら:

```bash
./scripts/gen-proto.sh
```

`golang:1.25-alpine` コンテナで protoc + protoc-gen-go + protoc-gen-go-grpc を
インストールして `*.pb.go` を吐かせる。ホストに何もインストールする必要なし。

## サービス間通信

- BFF は起動時に metrics/logs それぞれに **gRPC stream を1本だけ**開き、
  受信した Tick / LogEvent を内部 Hub に publish。
- 各ブラウザの `/ws` / `/ws/logs` は Hub の subscriber として fanout される。
- → upstream gRPC stream は **N=1 (BFF→各 service)**、つまり browser を増やしても
  micro service 側の負荷は増えない。

## REST → gRPC マッピング

| 公開 REST | 内部 gRPC | 変換 |
|---|---|---|
| `GET /api/history?metrics=...&minutes=&max_points=` | `metricspb.MetricsService.GetHistory(HistoryRequest)` | `Tick[]` → `{metrics:{name:{t:[],v:[]}}}` |
| `GET /api/logs/history?limit=` | `logspb.LogService.GetHistory(HistoryRequest)` | `LogEvent[]` → `wireLog[]` |
| `WS /ws` | `metricspb.MetricsService.StreamRealtime` | `Tick` → `{t,v:{...}}` JSON |
| `WS /ws/logs` | `logspb.LogService.StreamRealtime` | `LogEvent` → `{id,t,level,src,msg}` JSON |

## CDK (本番想定)

```bash
cd cdk
npm install
npx cdk synth                     # 3 stacks の CloudFormation を生成
npx cdklocal deploy --all         # LocalStack に向けて deploy
```

スタック構成:

```
WebgraphVpc  ─┬─> WebgraphAlb  ─> WebgraphEcs
              └────────────────────┘
                  (ECS → ALB / VPC 一方向、サイクル無し)
```

| Stack | 主要リソース | 目的 |
|---|---|---|
| WebgraphVpc | VPC, 2AZ Public+Private Subnet, NATGW | ネットワーク基盤 |
| WebgraphAlb | ALB, TargetGroup (sticky, /healthz health check, idle 300s for WS) | BFF への外部入口 |
| WebgraphEcs | Cluster + Cloud Map namespace + 3 FargateService + 共有 ServiceSg | 全コンテナの実行 |

## grpcurl で micro service を直接叩く

```bash
# proto descriptor を持って query
grpcurl -plaintext -proto proto/metrics/metrics.proto \
  -d '{"metric_names":["cpu","memory"]}' \
  localhost:50051 metrics.MetricsService/StreamRealtime
```

## モノリスとの違い

| | モノリス (`../backend`) | このマイクロサービス |
|---|---|---|
| Process | 1 (server, writer 含めて) | 3 (bff, metrics, logs) |
| ストレージ | PostgreSQL に永続化 | in-memory ring (各 service) |
| サービス間通信 | プロセス内関数呼び出し | gRPC streaming |
| データ Loss | DB 永続化のため durable | プロセス再起動で履歴消失 |
| スケーリング | 1 process を縦に | 各 service を横に N replicas |
| デプロイ単位 | 1 image | 3 image (独立) |

両者で **フロントエンドのワイヤフォーマットは完全互換**。
`docker-compose down && cd aws-microservices && docker-compose up` だけで swap できる。
