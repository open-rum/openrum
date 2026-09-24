# 2026-09-18 本地单机容量复测

<!-- cspell:ignore GOARCH -->

这是开发机上的真实合成负载测试，不是云集群测试、生产容量认证或并发用户数承诺。首页与中英文 Benchmarks 页面使用同一份结构化证据；历史失败结果保留在本目录。

## 机器与拓扑

| 项目 | 本次配置 |
| --- | --- |
| 主机 | Apple M4 Pro，12 核 CPU，24 GiB 内存，arm64 |
| 系统 | macOS 27.0（26A428），Darwin 27.0 |
| Docker | 29.4.0，虚拟机 12 vCPU / 7.75 GiB 内存 |
| 应用 | API、Ingest、Consumer 各一个测试副本，Go 1.26.6 编译的 linux/arm64 二进制 |
| 数据服务 | Kafka 4.1.1（1 Broker、12 分区、复制因子 1）；ClickHouse 25.8 单节点；PostgreSQL 16；Redis 7.2 |
| 压测器 | k6 2.2.0，两个容器分别施加接收与查询负载，与服务共享主机 |
| 资源边界 | 无单服务 CPU / 内存配额；所有容器共享 Docker 虚拟机资源，不是每个服务独占 24 GiB |
| 其他负载 | 本地开发服务、浏览器和既有 Kubernetes 节点继续运行，非独占压测机 |
| 源码 | HEAD `291ed98` + 未提交工作区快照，非正式发布版本 |

测试服务不替换日常 API / Ingest。为避免同一 Kafka consumer group 的旧 Consumer 分走测试事件，测试期间暂停旧 Consumer，结束后恢复。没有清空业务数据或扩大限流配额。

## 实际优化与试验边界

1. 性能聚合只读取 `page_view` / `web_vital`，选项查询也提前限定对应指标事件。保留环境、Route、合成数据排除及样本量语义；集成测试加入无关错误/API/自定义事件验证结果不变。
2. Consumer 的并行 worker 数和批量刷新间隔改为可配置，默认仍为 **4 / 10 ms**。本次本地配置为 **12 / 50 ms**，让共享批次容纳更多事件；不是所有部署的通用最优值。
3. 本地测试 API 的 ClickHouse DSN 使用 `max_threads=2`，没有限制成 8 个数据库连接。曾测试“2 线程 + 8 连接池”，排队超时更严重，已撤销该源码实验。
4. 观察到 `system.metric_log` 后台合并任务单独使用约 1.5 GiB。测试时仅将该系统表 `merge_max_block_size` 从默认 8192 调为 1024，降低合并块的行数；没有删除日志、禁用日志、修改内存保护阈值或更改业务表设置。测试结束恢复原设置。这是本地试验配置，不自动推广到生产。

ClickHouse 官方说明该设置控制合并时读入内存的行数：[MergeTree settings](https://clickhouse.com/docs/operations/settings/merge-tree-settings#merge_max_block_size)。减少后台合并内存并不保证解决全部内存压力；失败的持续测试仍需保留。

## 负载和验收口径

- 独立测试组织、用户和项目；测试身份的登录会话仅有效 2 小时，结束后撤销登录会话与上报 Key，并禁用测试身份/项目。
- 每批 100 个事件，100% 采样。固定混合为：40% 自定义事件、20% 页面访问、20% API、10% LCP、10% 错误。
- 2,000 events/s 对应约 20 个上报 HTTP 请求/秒，不是 2,000 个并发连接。10 query req/s 指 API 请求率，一个 API 请求可能包含多条数据库查询。
- 仅一个 Route、三个错误消息变体，一个批次共享一个 Session 和页面上下文；不是高基数多路由业务模型，也不是实际浏览器 SDK 性能测试。
- 查询随机覆盖 overview / issues / performance / apis / usage，最近 1 小时、production 环境。多轮数据不断累积，不清表制造空表成绩。
- 写入和查询同时按 constant-arrival-rate 施压。各压测器预分配 32 VU，上限 256 VU；**VU 是负载生成器设置，不是支持的并发用户数**。
- 原门槛不放宽：Ingest P95 < 250 ms，查询 P95 < 2 s、P99 < 5 s，HTTP 失败率 < 1%。另要求所有业务检查通过、压测器丢弃迭代数为 0。
- 业务检查要求整批事件被接受，不能把部分接受的 207 或熔断下的空 202 当成功。
- 结束后按 `project_id` 和 `attributes['tag.load_run_id']` 核对 accepted = count = uniqExact(event_id)。所有事件类型使用同一标签，不只统计 custom 事件。
- 入库核对每 10 秒轮询；“≤ N 秒”只是停止负载后观察到全量一致的上界，不是单条事件的端到端 P95。
- Consumer 消息年龄和 Docker 资源每 10 秒采样，只报告采样最大值，不声称连续精确峰值。最终另查 Kafka 分区 offset lag。

## 结果来源

主展示轮次为 `local-final-2k-20260918`（UTC 10:24:41–10:29:43），因为它保留了完整 5 分钟观测，而不是挑选较早通过的 30 秒片段。结论：**接收通过，全部查询成功的严格门槛未通过**。

| 指标 | 5 分钟主展示轮次 | 3 分钟保守确认轮次 |
| --- | --- | --- |
| 目标负载 | 2,000 events/s + 10 query req/s | 1,000 events/s + 5 query req/s |
| Ingest P95 | 50.47 ms | 60.03 ms |
| 查询 P95 / P99 | 685.16 / 1,435.40 ms | 577.42 / 1,081.19 ms |
| 接收失败 / 丢弃迭代 | 0 / 0 | 0 / 0 |
| 查询失败 | 30 / 3,001（0.9997%） | 4 / 900（0.4444%） |
| accepted = stored = unique | 600,100 | 180,100 |
| 全部严格门槛 | 未通过 | 未通过 |

主展示轮次的原延迟和 `<1%` 失败率门槛达到，但新增的全部业务检查成功要求未达到，不能写成全量通过。查询错误为 ClickHouse code 241 / 全局内存保护；减小 `metric_log` 合并块后仍有错误，因此该设置不是已验证的根治方案。

主轮次开始前项目已有 3,864,400 条原始事件，结束后 4,464,500 条。Consumer 消息年龄的采样最大值为 1.140 秒；负载结束后首次核对在 0.319 秒完成（页面保守标为 ≤1 秒）。最后全部试跑结束时，12 个 Kafka 分区 offset lag 均为 0。10 秒资源采样中，ClickHouse 的 Docker 内存读数最高约 4.16 GiB、CPU 684.24%（约 6.84 核）；这些是采样读数，不是连续精确峰值。

旧的系统日志表合并还被观察到约 1.5 GiB 单任务开销。全局内存保护发生时的短暂峰值不能用 Docker 每 10 秒的采样值排除；仍需进一步治理后台合并/内存预算，并在独占或目标生产资源下验证。

- 最新展示数据：`apps/site/src/content/evidence/local-capacity-2026-09-18.json`。
- 主轮次原始 k6 统计：[`ingest.json`](results/2026-09-18/ingest.json)、[`query.json`](results/2026-09-18/query.json)；硬件、时间、核对与资源采样摘要：[`run-summary.json`](results/2026-09-18/run-summary.json)。完整原始采样仍留在私有 `.openrum/benchmark-2026-09-18/` 目录。
- 本次档位探索与失败记录：[`results/2026-09-18/discovery.json`](results/2026-09-18/discovery.json)。协议不合法的早期混合事件试跑明确标为无效，不作为容量结果。
- 历史过载结果：[`initial-capacity.md`](initial-capacity.md)，不覆盖、不删除。

不同轮次的负载、数据量、进程版本和配置不同，不能用这些数字直接计算同条件加速倍数。生产高可用、多副本、故障切换、高基数查询与 15 分钟以上的峰值负载仍未验证。

## 在本地复测

仅适用于仓库默认本地 Compose 拓扑，**不要对生产执行**。先启动开发数据服务并应用迁移。测试会短暂暂停原 Consumer，请避开需要实时消费的开发工作。

```sh
# 创建独立身份；凭证只写入被 Git 忽略的私有目录，不要提交或粘贴凭证。
go run ./tests/load/local-fixture .openrum/benchmark

# Apple Silicon。其他架构需匹配 Docker daemon 的 CPU 架构。
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o .openrum/benchmark/consumer ./services/consumer/cmd/consumer
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o .openrum/benchmark/api ./services/api/cmd/api
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o .openrum/benchmark/ingest ./services/ingest/cmd/ingest
node tests/load/consumer-variant.mjs start .openrum/benchmark/consumer 12 50ms
node tests/load/service-variant.mjs api .openrum/benchmark/api 2
node tests/load/service-variant.mjs ingest .openrum/benchmark/ingest

# 先检查本机原设置。本次为默认 8192；若不同，请记录实际原值并在结束后恢复。
docker exec openrum-clickhouse-1 clickhouse-client --query "SELECT right(create_table_query,500) FROM system.tables WHERE database='system' AND name='metric_log'"
docker exec openrum-clickhouse-1 clickhouse-client --query "ALTER TABLE system.metric_log MODIFY SETTING merge_max_block_size=1024"

WORKLOAD=mixed CONSUMER_CONTAINER=openrum-benchmark-consumer \
OPENRUM_BENCHMARK_API_URL=http://openrum-benchmark-api:8080 \
OPENRUM_BENCHMARK_INGEST_URL=http://openrum-benchmark-ingest:8081/ingest/v1/envelope \
node tests/load/run-local.mjs .openrum/benchmark unique-run-id 2000 10 300s
```

运行 ID 不可重复覆盖。任何门槛未通过，工具退出码为 1，但仍保存结果；不要因为命令失败就遗漏清理。`ingest.json` / `query.json` 为 k6 原始统计，`run.json` 保存配置、资源采样、时间和入库核对。私有原始目录不要整体发布，只发布经过检查、不含登录会话/Key 的结果文件。

负载结束并确认积压排空后，**无论测试是否通过都执行恢复**：

```sh
node tests/load/consumer-variant.mjs restore
docker stop --timeout 30 openrum-benchmark-api openrum-benchmark-ingest
docker rm openrum-benchmark-api openrum-benchmark-ingest
# 本次原先没有显式覆盖，恢复默认；如果原先有覆盖应恢复已记录的原值。
docker exec openrum-clickhouse-1 clickhouse-client --query "ALTER TABLE system.metric_log RESET SETTING merge_max_block_size"
go run ./tests/load/local-fixture revoke <创建时输出的测试项目ID>
```

上述清理只移除临时服务容器、撤销专用身份，不删除卷或业务数据。测试事件保留给既有 TTL / 数据保留流程处理。
