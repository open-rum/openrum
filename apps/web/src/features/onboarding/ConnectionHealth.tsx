import type { ConnectionStatus } from "@/lib/api/client";
import { rejectGuidance } from "./guidance";

export function ConnectionHealth({ status }: { status: ConnectionStatus }) {
  const rejectedAt = status.lastRejectAt ? Date.parse(status.lastRejectAt) : null;
  const receivedAt = status.lastEventReceivedAt ? Date.parse(status.lastEventReceivedAt) : null;
  // An accepted event after a refusal is evidence of later success, not proof that
  // every producer is healthy. Keep both observations visible instead of a red/green verdict.
  const receivedAfterReject = rejectedAt !== null && receivedAt !== null && receivedAt > rejectedAt;
  const guidance = status.lastRejectReason ? rejectGuidance[status.lastRejectReason] : undefined;
  return (
    <section className="card card-border bg-base-100" aria-labelledby="connection-health-title">
      <div className="card-body gap-3">
        <h2 className="card-title text-base" id="connection-health-title">
          最近采集状态
        </h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Observation label="最近成功接收" value={status.lastEventReceivedAt} />
          <Observation label="最近数据可查询" value={status.lastEventQueryableAt} />
        </dl>
        {status.lastRejectReason ? (
          <div
            role="status"
            className={`alert alert-soft ${receivedAfterReject ? "alert-info" : "alert-warning"}`}
          >
            <div>
              <p className="font-medium">
                {receivedAfterReject ? "历史拒收记录 · 此后已成功接收事件" : "最近检测到事件拒收"}
              </p>
              <p className="mt-1">
                {guidance?.title ?? "部分上报请求被拒收"} ·{" "}
                {status.lastRejectAt ? formatTime(status.lastRejectAt) : "时间未知"}
              </p>
              <p className="mt-1">{guidance?.action ?? "请检查 SDK 配置与事件内容后刷新状态。"}</p>
              <p className="mt-1">拒收记录不代表全部事件失败；下方接入进度仅表示已验证过的阶段。</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-base-content/70">
            暂无拒收记录。以上时间是最近一次成功记录，不代表持续在线。
          </p>
        )}
      </div>
    </section>
  );
}

function Observation({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-base-content/70">{label}</dt>
      <dd>{value ? <time dateTime={value}>{formatTime(value)}</time> : "尚未观测到"}</dd>
    </div>
  );
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(
    new Date(value),
  );
}
