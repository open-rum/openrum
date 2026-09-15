import { useState } from "react";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  apiFailureRate,
  formatAPIBytes,
  formatAPIDuration,
  formatAPILatencyBucket,
  minimumAPISamples,
  type APIsResponse,
} from "@/lib/api/apis";
import { ApiTrend } from "./ApiTrend";
import { sessionEventHref } from "@/lib/api/sessions";

type Detail = NonNullable<APIsResponse["detail"]>;

export function ApiDetail({
  detail,
  projectId,
  onClose,
}: {
  detail: Detail;
  projectId: string;
  onClose: () => void;
}) {
  const failureRate = apiFailureRate(detail.endpoint);
  return (
    <Drawer open direction="right" onOpenChange={(open) => !open && onClose()}>
      {/* Width lives in the stylesheet: the base drawer caps a right-side panel
          at sm:max-w-sm through a data-attribute variant, which outranks any
          plain width utility passed in here. */}
      <DrawerContent className="api-detail-drawer">
        <DrawerHeader className="api-detail-header">
          <div>
            <span>
              <MethodBadge method={detail.endpoint.method} />
              <Badge variant={detail.endpoint.failures ? "destructive" : "secondary"}>
                {failureRate.toFixed(1)}% 失败
              </Badge>
            </span>
            <DrawerTitle>{detail.endpoint.url}</DrawerTitle>
            <DrawerDescription>
              只展示标准化 URL 和安全上下文，不包含 query、body、Cookie 或 headers。
            </DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button size="icon" variant="ghost" aria-label="关闭详情">
              <XIcon />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <div className="api-detail-body">
          <section className="api-detail-metrics">
            <Metric
              label="请求"
              value={Math.round(detail.endpoint.estimated).toLocaleString()}
              note={`${detail.endpoint.requests.toLocaleString()} 个采样事件`}
            />
            <Metric label="P50" value={formatAPIDuration(detail.endpoint.p50)} />
            <Metric label="P75" value={formatAPIDuration(detail.endpoint.p75)} />
            <Metric
              label="P95"
              value={formatAPIDuration(detail.endpoint.p95)}
              note={detail.endpoint.sufficient ? undefined : `样本少于 ${minimumAPISamples}`}
            />
            <Metric
              label="响应大小 P50"
              value={formatAPIBytes(detail.payload.p50)}
              note={
                detail.payload.samples
                  ? `P95 ${formatAPIBytes(detail.payload.p95)}`
                  : "无 content-length"
              }
            />
          </section>
          <section className="api-detail-section">
            <h3>请求与失败趋势</h3>
            <ApiTrend trend={detail.trend} label="该 endpoint " />
          </section>
          {/* Two bar lists of similar height, paired so the wide panel is not
              one long single column. */}
          <section className="api-detail-section api-detail-section--paired">
            <h3>响应状态码</h3>
            <StatusBreakdown statuses={detail.statuses} />
            <p className="api-detail-note">
              失败率只计入 5xx 与网络类错误；{detail.endpoint.clientErrors.toLocaleString()} 次 4xx
              单独列出。
            </p>
          </section>
          <section className="api-detail-section api-detail-section--paired">
            <h3>延迟分布</h3>
            <LatencyHistogram buckets={detail.latency} />
          </section>
          <section className="api-detail-section">
            <h3>维度下钻</h3>
            <DimensionBreakdown dimensions={detail.dimensions} endpoint={detail.endpoint} />
          </section>
          <section className="api-detail-section">
            <h3>关联 Route</h3>
            <div className="api-route-facets">
              {detail.routes.map((route) => (
                <p key={route.route}>
                  <code>{route.route}</code>
                  <span>{route.requests.toLocaleString()} 请求</span>
                  <strong>{route.failures.toLocaleString()} 失败</strong>
                </p>
              ))}
            </div>
          </section>
          <section className="api-detail-section">
            <h3>事件样本</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>状态</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>会话</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.samples.map((sample) => (
                  <TableRow key={sample.eventId}>
                    <TableCell>
                      <Badge
                        variant={sample.failure || sample.status >= 500 ? "destructive" : "outline"}
                      >
                        {sample.failure || sample.status || "network"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {Math.round(sample.durationMs)} ms
                    </TableCell>
                    <TableCell>
                      <code>{sample.route || sample.pageUrl}</code>
                    </TableCell>
                    <TableCell>{new Date(sample.timestamp).toLocaleString("zh-CN")}</TableCell>
                    <TableCell>
                      <a
                        href={sessionEventHref(
                          projectId,
                          sample.sessionId,
                          sample.timestamp,
                          sample.eventId,
                        )}
                        title={sample.sessionId}
                      >
                        查看会话
                      </a>
                      {sample.traceId ? <small title={sample.traceId}>trace 已关联</small> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Exact status codes separate problems the aggregate 4xx/5xx split hides: a
 * burst of 429 and a burst of 404 need completely different responses.
 */
function StatusBreakdown({ statuses }: { statuses: Detail["statuses"] }) {
  if (!statuses.length) return <p className="api-detail-note">当前范围没有状态码样本。</p>;
  const total = statuses.reduce((sum, item) => sum + item.requests, 0);
  return (
    <ul className="api-status-breakdown" aria-label="响应状态码分布">
      {statuses.map((item) => (
        <li key={`${item.status}:${item.failure ?? ""}`} data-tone={statusTone(item)}>
          <span>{item.status || item.failure || "无响应"}</span>
          <i style={{ width: `${(item.requests / total) * 100}%` }} />
          <b>{item.requests.toLocaleString()}</b>
          <em>{((item.requests / total) * 100).toFixed(1)}%</em>
        </li>
      ))}
    </ul>
  );
}

function statusTone(item: Detail["statuses"][number]) {
  if (!item.status) return "network";
  if (item.status >= 500) return "server";
  if (item.status >= 400) return "client";
  return "ok";
}

function LatencyHistogram({ buckets }: { buckets: Detail["latency"] }) {
  if (!buckets.length) return <p className="api-detail-note">当前范围没有延迟样本。</p>;
  const maximum = Math.max(...buckets.map((bucket) => bucket.requests));
  const total = buckets.reduce((sum, bucket) => sum + bucket.requests, 0);
  return (
    <ul className="api-latency-histogram" aria-label="延迟分布">
      {buckets.map((bucket) => (
        <li key={bucket.fromMs}>
          <span>{formatAPILatencyBucket(bucket)}</span>
          <i style={{ width: `${(bucket.requests / maximum) * 100}%` }} />
          <b>{bucket.requests.toLocaleString()}</b>
          <em>{((bucket.requests / total) * 100).toFixed(1)}%</em>
        </li>
      ))}
    </ul>
  );
}

const dimensionTabs = [
  { key: "browsers", label: "浏览器" },
  { key: "operatingSystems", label: "操作系统" },
  { key: "devices", label: "设备" },
  { key: "countries", label: "国家" },
  { key: "releases", label: "版本" },
] as const;

/**
 * Compares each segment's P95 and failure rate against the endpoint baseline so
 * a regression confined to one browser or release stands out.
 */
function DimensionBreakdown({
  dimensions,
  endpoint,
}: {
  dimensions: Detail["dimensions"];
  endpoint: Detail["endpoint"];
}) {
  const available = dimensionTabs.filter((tab) => dimensions[tab.key].length > 0);
  const [active, setActive] = useState<(typeof dimensionTabs)[number]["key"]>("browsers");
  if (!available.length) {
    return <p className="api-detail-note">当前范围没有可下钻的维度样本。</p>;
  }
  const selected = available.find((tab) => tab.key === active) ?? available[0];
  const facets = dimensions[selected.key];
  const baseline = endpoint.p95;
  return (
    <div className="api-dimensions">
      <div className="api-dimension-tabs" role="group" aria-label="下钻维度">
        {available.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            size="sm"
            variant={tab.key === selected.key ? "default" : "outline"}
            aria-pressed={tab.key === selected.key}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{selected.label}</TableHead>
            <TableHead>请求</TableHead>
            <TableHead>失败率</TableHead>
            <TableHead>P95</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {facets.map((facet) => {
            const rate = apiFailureRate(facet);
            const slower = baseline !== null && facet.p95 !== null && facet.p95 > baseline * 1.25;
            return (
              <TableRow key={facet.value}>
                <TableCell>{facet.value}</TableCell>
                <TableCell>{facet.requests.toLocaleString()}</TableCell>
                <TableCell>
                  <span data-failing={facet.failures > 0}>{rate.toFixed(2)}%</span>
                </TableCell>
                <TableCell>
                  <span data-slower={slower}>{formatAPIDuration(facet.p95)}</span>
                  {slower ? <small>高于整体 P95</small> : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return (
    <Badge variant="outline" className={`method-badge method-${method.toLowerCase()}`}>
      {method}
    </Badge>
  );
}
function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <em>{note}</em> : null}
    </div>
  );
}
