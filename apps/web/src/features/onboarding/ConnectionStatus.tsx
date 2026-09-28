import { CircleCheckIcon as CheckCircleIcon, CircleIcon, LoaderCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConnectionStatus as ConnectionStatusData } from "@/lib/api/client";

type ConnectionStatusProps = {
  status?: ConnectionStatusData;
  loading: boolean;
  hasInstallDSN: boolean;
};

export function ConnectionStatus({ status, loading, hasInstallDSN }: ConnectionStatusProps) {
  if (loading && !status) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-label="正在检查接入状态">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-24" key={index} />
        ))}
      </div>
    );
  }
  const stages = [
    {
      title: "1. 客户端 DSN",
      description: "项目具备可用的浏览器连接字符串",
      complete: status?.keyConfigured ?? false,
      time: null,
    },
    {
      title: "2. SDK 配置",
      description: "配置已复制到前端应用并准备发布",
      complete: Boolean(status?.lastSdkSeenAt),
      active: hasInstallDSN && !status?.lastSdkSeenAt,
      time: null,
    },
    {
      title: "3. SDK 已连接",
      description: "Ingest 已识别 SDK 请求并收到事件",
      complete: Boolean(status?.lastEventReceivedAt),
      active: Boolean(status?.lastSdkSeenAt) && !status?.lastEventReceivedAt,
      time: status?.lastSdkSeenAt,
    },
    {
      title: "4. 数据可查询",
      description: "Consumer 已写入 ClickHouse，可进入仪表盘",
      complete: Boolean(status?.lastEventQueryableAt),
      active: Boolean(status?.lastEventReceivedAt) && !status?.lastEventQueryableAt,
      time: status?.lastEventQueryableAt,
    },
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-2" aria-label="四阶段接入进度">
      {stages.map((stage) => (
        <li
          className="flex min-h-24 gap-3 rounded-lg border border-border bg-card p-4"
          key={stage.title}
        >
          <span className="mt-0.5 text-primary" aria-hidden="true">
            {stage.complete ? (
              <CheckCircleIcon />
            ) : stage.active ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <CircleIcon />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm font-medium">{stage.title}</strong>
              <Badge variant={stage.complete ? "secondary" : "outline"}>
                {stage.complete ? "完成" : stage.active ? "检测中" : "等待"}
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">{stage.description}</p>
            {stage.time ? (
              <time className="mt-2 block text-xs text-muted-foreground" dateTime={stage.time}>
                {formatTime(stage.time)}
              </time>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(
    new Date(value),
  );
}
