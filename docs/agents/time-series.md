# Console 时间序列间隔标准

新增或修改 Console 的时间趋势图、趋势查询、聚合间隔、补点、坐标轴或缓存时，
**先读本文，再实现需求**。这是统一规则，不再由各个页面自行决定图表密度。

## 统一规则

- 每条时间序列以 **最多约 30 个时间桶**为目标，不是必须生成 30 个点。
- Line、Area、时间维度 Bar、Stat 小图、编辑预览和放大详情共用同一规则。
- 点数与窗口宽度、卡片尺寸、图表类型无关；缩放只调整布局和轴标签，不重新聚合。
- 后端根据查询时长选取能覆盖范围的最小允许间隔。
- 不得小于数据源粒度。例如 5 分钟汇总表不能拆成 1 分钟或 2 分钟数据。
- UTC 时间桶按既有存储规则对齐；起止时间未对齐时，可多出一个部分边界桶。
  不把首尾部分桶伪装成完整桶，也不为了凑点数拉大查询范围。
- 多条线共享时间桶。30 指每条线的时间位置，不是所有线的数值个数总和。
- 饼图、圆环、分类 Bar、直方图、漏斗、留存和逐事件时间线不适用该点数规则。

允许间隔：1、2、5、10、15、30 分钟；1、2、3、4、6、12 小时；1、2 天。
目前 Console 分析范围最长 30 天；扩大时间范围时必须同步扩展本策略，不可截断结果。

以最细支持 1 分钟的数据源为例：

| 查询范围 | 聚合间隔 | 对齐时的时间桶数 |
| --- | --- | --- |
| 5 分钟 | 1 分钟 | 5 |
| 1 小时 | 2 分钟 | 30 |
| 6 小时 | 15 分钟 | 24 |
| 24 小时 | 1 小时 | 24 |
| 7 天 | 6 小时 | 28 |
| 30 天 | 1 天 | 30 |

非对齐范围最多再多 1 个边界桶；没有观测的桶不一定有可见点或柱子。
错误详情读取 `issue_metrics_5m`，最小间隔为 5 分钟：5 分钟范围约 1 个桶，
1 小时范围约 12 个桶。错误概览读取原始事件，因此使用上表的 1 分钟下限。

## 统计含义与缺失数据

- 在后端按目标间隔聚合原始事件或合并聚合状态，不能在前端隔几个点取一个。
- 计数合并计数；UV、用户、会话按桶重新去重或合并 distinct 状态。
  P75/P95 合并分位数状态，不能平均已有分位数；比率用合并后的分子和分母计算。
- 整段 KPI 与时间序列分别计算，不能为了限制点数改变整段统计口径。
- 未返回或未知的时间桶用 `null` 保留时间位置，不默认补 0。
  后端明确返回的真实 0 保持为 0；全空序列显示空态，不伪造曲线。
- Line/Area 不跨 `null` 连线；孤立真实样本显示点，避免它在断点之间消失。
- 平滑曲线沿用 `lib/charts/smoothCurve.ts`，不得通过平均数据来消除峰值。

## 前后端契约

- 新建趋势响应返回有效的 `from`、`to`、`intervalSeconds`，并按桶时间升序输出。
- 页面显示服务端实际间隔，如「自动 · 1 小时」。旧 API 缺少间隔时不猜测、不显示假标签。
- 时间轴只保留约 2–6 个可读标签，随容器宽度适配；减少标签不等于减少数据点。
- Tooltip/详情保留准确时间及数值。放大与预览复用已有数据，不另取更密的点。
- 支持 `maxPoints` 的 API，Console 统一传 `TIME_SERIES_MAX_POINTS`；点数必须参与缓存键。
  其他趋势接口可直接采用后端的统一默认策略，不必为单页创造新的密度参数。
- 既有 API 的无参数兼容行为不可静默修改；迁移对应 Console 调用端时显式接入本策略。

## 代码入口

| 职责 | 入口 |
| --- | --- |
| 后端 30 点目标、允许间隔、数据源下限 | `internal/query/time_series.go`：`ConsoleSeriesMaxPoints`、`ConsoleSeriesInterval`、`adaptiveSeriesInterval` |
| 前端目标、补空桶、间隔文案、时间标签 | `apps/web/src/lib/charts/timeSeries.ts` |
| 响应式轴标签宽度、孤立点 | `apps/web/src/lib/charts/useChartWidth.ts`、`isolatedDot.tsx` |
| 大盘查询与数据适配 | `apps/web/src/features/dashboard/queries.ts`、`adapters.ts` |
| 大盘兼容导出和 Context | `apps/web/src/features/dashboard/chartDensity.ts`、`DashboardDensity.tsx` |
| 大盘后端 | `internal/query/overview.go`、`analytics.go`；显式 `maxPoints` 分支 |
| 错误概览和详情后端 | `internal/query/issues.go`：`Overview`、`Trend`；`services/api/internal/handlers/issues.go` |
| 错误前端响应与图表 | `apps/web/src/lib/api/issues.ts`；`features/issues/IssueOverviewCharts.tsx`、`IssueTrend.tsx` |

新功能直接使用公共入口，不从 `features/dashboard` 引用工具，也不复制一套间隔表。
前后端的 30 点常量必须保持一致。

## 已接入范围与遗留入口

已接入：大盘的时间序列/Stat/预览/详情，以及错误概览和错误详情。

这次不宣称所有历史图表均已迁移。后续修改以下趋势需求时，先按本文接入，
同时核对底层汇总表的分辨率，不能只改变前端显示标签：

- 分析/事件独立页面及性能/API：`performanceInterval` 和未传 `maxPoints` 的调用。
- 日志：`internal/query/logs.go` 中原有约 120 桶策略。
- 用量：`internal/query/usage.go`，数据源最细为 1 小时。
- 不带 `maxPoints` 的旧 Overview API 客户端保留原有兼容行为。

本文定义实现契约与定位入口，不要求每次需求额外进行一轮浏览器验收；
是否运行验收遵循当次用户要求，不可把未执行的检查写成已通过。
