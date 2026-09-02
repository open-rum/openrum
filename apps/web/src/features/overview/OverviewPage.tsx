import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  ArrowUp,
  CaretDown,
  Check,
  Info,
  Plus,
  X,
} from "@phosphor-icons/react";
import { QualityTrend, Sparkline } from "../../components/Charts";
import { ThemeToggle } from "../../components/theme/ThemeToggle";
import { WorldMap } from "../../components/WorldMap";
import {
  apis,
  attentionItems,
  browsers,
  countries,
  customBreakdown,
  devices,
  issues,
  kpis,
} from "../../data/mock";

type AudienceTab = "国家" | "设备" | "浏览器" | "自定义维度";
type DrawerItem = { title: string; subtitle: string; type: "issue" | "api" } | null;

const audienceTabs: AudienceTab[] = ["国家", "设备", "浏览器", "自定义维度"];

export function OverviewPage() {
  const [release, setRelease] = useState("v2.18.0 (2026-09-02 14:20)");
  const [timeRange, setTimeRange] = useState("过去 24 小时");
  const [audienceTab, setAudienceTab] = useState<AudienceTab>("国家");
  const [country, setCountry] = useState("全部");
  const [device, setDevice] = useState("全部");
  const [compare, setCompare] = useState(false);
  const [querySaved, setQuerySaved] = useState(false);
  const [drawer, setDrawer] = useState<DrawerItem>(null);
  const [refreshed, setRefreshed] = useState("18 秒前更新");

  const scopeText = useMemo(
    () =>
      `${country === "全部" ? "全部国家" : country} · ${device === "全部" ? "全部设备" : device}`,
    [country, device],
  );

  function refresh() {
    setRefreshed("刚刚更新");
    window.setTimeout(() => setRefreshed("18 秒前更新"), 2200);
  }

  return (
    <div className="overview-page">
      <header className="page-header">
        <div>
          <div className="breadcrumb">
            项目 <span>/</span> 商城 H5 <span>/</span> 数据大盘
          </div>
          <div className="title-line">
            <h1>生产环境概览</h1>
            <Info size={15} />
          </div>
        </div>
        <div className="header-controls">
          <label className="select-control">
            <span>版本</span>
            <select value={release} onChange={(event) => setRelease(event.target.value)}>
              <option>v2.18.0 (2026-09-02 14:20)</option>
              <option>v2.17.0 (2026-09-01 09:40)</option>
              <option>全部版本</option>
            </select>
            <CaretDown size={12} />
          </label>
          <label className="select-control select-control--range">
            <select value={timeRange} onChange={(event) => setTimeRange(event.target.value)}>
              <option>过去 24 小时</option>
              <option>过去 7 天</option>
              <option>过去 30 天</option>
            </select>
            <CaretDown size={12} />
          </label>
          <button
            className="icon-button"
            type="button"
            onClick={refresh}
            aria-label={`刷新数据，${refreshed}`}
            title={refreshed}
          >
            <ArrowClockwise size={16} />
          </button>
          <ThemeToggle />
        </div>
      </header>

      <section className="kpi-strip" aria-label="核心指标">
        {kpis.map((item) => (
          <article className="kpi" key={item.label}>
            <div className="kpi__label">
              {item.label} {item.suffix && <small>({item.suffix})</small>}
            </div>
            <strong>{item.value}</strong>
            <div className={`delta delta--${item.tone}`}>
              {item.tone === "good" ? (
                <ArrowUp size={12} />
              ) : item.tone === "bad" ? (
                <ArrowUp size={12} />
              ) : (
                <span>—</span>
              )}
              <span>{item.delta}</span>
              <small>较昨日</small>
            </div>
          </article>
        ))}
      </section>

      <section className="module-grid module-grid--trend">
        <article className="panel trend-panel">
          <div className="panel__header panel__header--chart">
            <div>
              <h2>访问量与稳定性</h2>
              <div className="chart-legend">
                <span>
                  <i className="legend-dot legend-dot--pv" />
                  PV
                </span>
                <span>
                  <i className="legend-dot legend-dot--uv" />
                  UV
                </span>
                <span>
                  <i className="legend-dot legend-dot--error" />
                  错误率
                </span>
                <span>
                  <i className="legend-dot legend-dot--release" />
                  发布 {release.split(" ")[0]}
                </span>
              </div>
            </div>
          </div>
          <QualityTrend compare={compare} />
        </article>

        <article className="panel attention-panel">
          <div className="panel__header">
            <h2>需要处理</h2>
            <button className="link-button" type="button">
              查看全部
            </button>
          </div>
          <div className="attention-list">
            {attentionItems.map((item, index) => (
              <button
                type="button"
                className="attention-row"
                key={item.title}
                onClick={() =>
                  setDrawer({
                    title: item.title,
                    subtitle: item.detail,
                    type: index === 1 ? "api" : "issue",
                  })
                }
              >
                <span className={`rank rank--${index + 1}`}>{index + 1}</span>
                <span className="attention-row__content">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                  <small>{item.meta}</small>
                </span>
                <span className={`severity severity--${index + 1}`}>
                  <i />
                  {item.severity}
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="module-grid module-grid--analytics">
        <article className="panel audience-panel">
          <div className="panel__header audience-header">
            <div>
              <h2>用户与环境分析</h2>
              <div className="tabs" role="tablist" aria-label="用户与环境分析维度">
                {audienceTabs.map((tab) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={audienceTab === tab}
                    className={audienceTab === tab ? "tab is-active" : "tab"}
                    key={tab}
                    onClick={() => setAudienceTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <div className="audience-filters">
              <label>
                国家 =
                <select value={country} onChange={(event) => setCountry(event.target.value)}>
                  <option>全部</option>
                  <option>中国</option>
                  <option>美国</option>
                  <option>日本</option>
                </select>
              </label>
              <label>
                设备类型 =
                <select value={device} onChange={(event) => setDevice(event.target.value)}>
                  <option>全部</option>
                  <option>iOS</option>
                  <option>Android</option>
                  <option>Desktop</option>
                </select>
              </label>
              <button
                className={compare ? "outline-button is-active" : "outline-button"}
                type="button"
                onClick={() => setCompare((value) => !value)}
              >
                <ArrowClockwise size={13} /> 对比
              </button>
            </div>
          </div>
          <AudienceContent activeTab={audienceTab} scope={scopeText} />
        </article>

        <article className="panel custom-panel">
          <div className="panel__header">
            <div>
              <h2>自定义数据</h2>
              <small>查询条件</small>
            </div>
            <button className="outline-button" type="button" onClick={() => setQuerySaved(true)}>
              <Plus size={13} />
              创建自定义查询
            </button>
          </div>
          <div className="query-builder">
            <QueryRow label="事件" value="checkout_submit" />
            <QueryRow label="指标" value="checkout_success_rate（成功率）" trailing="96.8%" />
            <QueryRow
              label="数值指标"
              value="payment_duration（支付耗时）"
              extra="p95"
              trailing="1.46s"
            />
            <QueryRow label="维度" value="channel, member_level, ab_variant" />
          </div>
          <div className="breakdown-title">按 channel 分布（checkout_success_rate）</div>
          <table className="compact-table custom-table">
            <thead>
              <tr>
                <th>channel</th>
                <th>成功率</th>
                <th>payment_duration (p95)</th>
              </tr>
            </thead>
            <tbody>
              {customBreakdown.map((row) => (
                <tr key={row.channel}>
                  <td>{row.channel}</td>
                  <td>{row.success}</td>
                  <td>{row.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      <section className="module-grid module-grid--tables">
        <article className="panel data-panel">
          <div className="panel__header">
            <h2>
              Top 问题 <small>（按影响用户）</small>
            </h2>
          </div>
          <div className="table-scroll">
            <table className="data-table issues-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>问题</th>
                  <th>类型</th>
                  <th>影响用户</th>
                  <th>影响用户占比</th>
                  <th>事件数</th>
                  <th>趋势</th>
                  <th>首次发生</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, index) => (
                  <tr
                    key={issue.title}
                    onClick={() =>
                      setDrawer({ title: issue.title, subtitle: issue.path, type: "issue" })
                    }
                  >
                    <td>{index + 1}</td>
                    <td>
                      <strong>{issue.title}</strong>
                      <small>{issue.path}</small>
                    </td>
                    <td>{issue.type}</td>
                    <td>{issue.users}</td>
                    <td>{issue.share}</td>
                    <td>{issue.events}</td>
                    <td>
                      <Sparkline values={issue.trend} tone={index < 3 ? "bad" : "warn"} />
                    </td>
                    <td>{issue.time}</td>
                    <td>
                      <button type="button">查看</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel data-panel api-panel">
          <div className="panel__header">
            <h2>
              API 健康度 <small>（过去 24 小时）</small>
            </h2>
            <button className="link-button" type="button">
              查看全部
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table api-table">
              <thead>
                <tr>
                  <th>接口</th>
                  <th>请求量</th>
                  <th>错误率</th>
                  <th>p95 耗时</th>
                  <th>趋势</th>
                </tr>
              </thead>
              <tbody>
                {apis.map((api) => (
                  <tr
                    key={api.path}
                    onClick={() =>
                      setDrawer({
                        title: `${api.method} ${api.path}`,
                        subtitle: `p95 ${api.p95} · 错误率 ${api.errorRate}`,
                        type: "api",
                      })
                    }
                  >
                    <td>
                      <span>{api.method}</span> <strong>{api.path}</strong>
                    </td>
                    <td>{api.requests}</td>
                    <td>{api.errorRate}</td>
                    <td>{api.p95}</td>
                    <td>
                      <Sparkline values={api.trend} tone={api.tone as "bad" | "warn" | "good"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      {drawer && (
        <aside className="detail-drawer" aria-label="详情面板">
          <div className="detail-drawer__header">
            <div>
              <small>{drawer.type === "issue" ? "异常详情" : "API 详情"}</small>
              <h2>{drawer.title}</h2>
              <p>{drawer.subtitle}</p>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setDrawer(null)}
              aria-label="关闭详情"
            >
              <X size={17} />
            </button>
          </div>
          <div className="drawer-metric">
            <span>当前状态</span>
            <strong>
              <i />
              需要处理
            </strong>
          </div>
          <div className="drawer-metric">
            <span>生产环境影响</span>
            <strong>过去 24 小时持续出现</strong>
          </div>
          <button className="primary-button" type="button" onClick={() => setDrawer(null)}>
            <Check size={15} />
            标记为已查看
          </button>
        </aside>
      )}

      {querySaved && (
        <div className="toast" role="status">
          <Check size={16} weight="bold" />
          <span>
            <strong>查询已创建</strong>
            <small>checkout_success_rate 已加入数据大盘</small>
          </span>
          <button type="button" onClick={() => setQuerySaved(false)} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function QueryRow({
  label,
  value,
  extra,
  trailing,
}: {
  label: string;
  value: string;
  extra?: string;
  trailing?: string;
}) {
  return (
    <div className="query-row">
      <span>{label}</span>
      <button type="button">
        {value}
        <CaretDown size={11} />
      </button>
      {extra && (
        <button type="button" className="query-row__extra">
          {extra}
          <CaretDown size={11} />
        </button>
      )}
      {trailing && <strong>{trailing}</strong>}
    </div>
  );
}

function AudienceContent({ activeTab, scope }: { activeTab: AudienceTab; scope: string }) {
  if (activeTab === "国家") {
    return (
      <div className="audience-content">
        <div className="map-block">
          <div className="subheading">
            国家分布（按 PV）<span>{scope}</span>
          </div>
          <WorldMap />
        </div>
        <RankList
          title="国家"
          rows={countries.map((item) => ({ name: item.name, value: item.pv, share: item.share }))}
        />
        <RankList title="设备类型（按 PV）" rows={devices} />
        <RankList title="浏览器（按 PV）" rows={browsers} />
      </div>
    );
  }

  const rows =
    activeTab === "设备"
      ? devices
      : activeTab === "浏览器"
        ? browsers
        : [
            { name: "channel = organic", value: "7.14M", share: "55.8%" },
            { name: "member_level = gold", value: "2.61M", share: "20.4%" },
            { name: "ab_variant = checkout_b", value: "1.96M", share: "15.3%" },
          ];
  return (
    <div className="audience-focus">
      <div>
        <small>当前分析维度</small>
        <strong>{activeTab}</strong>
        <p>按页面浏览量和受影响用户交叉分析，点击任意一行可继续下钻。</p>
      </div>
      <RankList title={activeTab} rows={rows} wide />
    </div>
  );
}

function RankList({
  title,
  rows,
  wide = false,
}: {
  title: string;
  rows: Array<{ name: string; value: string; share: string }>;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "rank-list rank-list--wide" : "rank-list"}>
      <div className="rank-list__head">
        <strong>{title}</strong>
        <span>PV</span>
        <span>占比</span>
      </div>
      {rows.map((row, index) => (
        <button type="button" className="rank-list__row" key={row.name}>
          <span>{index + 1}</span>
          <strong>{row.name}</strong>
          <span>{row.value}</span>
          <span>{row.share}</span>
          <ArrowRight size={11} />
        </button>
      ))}
    </div>
  );
}
