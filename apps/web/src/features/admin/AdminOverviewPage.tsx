import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  BoxIcon,
  CheckCircle2Icon,
  CircleHelpIcon,
  Clock3Icon,
  DatabaseIcon,
  HardDriveIcon,
  RefreshCwIcon,
  ServerCogIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { adminOverviewQueryOptions, type AdminOverview } from "@/lib/api/admin";
import { cn } from "@/lib/utils";
import { AdminPageLayout } from "./AdminPageLayout";

export function AdminOverviewPage() {
  const query = useQuery(adminOverviewQueryOptions());

  return (
    <AdminPageLayout
      title="实例运行概览"
      description="检查 OpenRUM 控制面、数据链路和依赖状态。页面不会显示连接串或凭证。"
      actions={
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCwIcon data-icon="inline-start" /> {query.isFetching ? "刷新中…" : "刷新状态"}
        </Button>
      }
    >
      {query.isLoading ? <AdminOverviewSkeleton /> : null}
      {query.error ? (
        <AsyncError
          error={query.error}
          title="无法加载实例状态"
          remediation="确认当前账号拥有实例管理员权限，并检查 API 服务。"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data ? <AdminOverviewContent overview={query.data} /> : null}
    </AdminPageLayout>
  );
}

function AdminOverviewContent({ overview }: { overview: AdminOverview }) {
  const healthy = overview.dependencies.filter((item) => item.status === "healthy").length;
  const unhealthy = overview.dependencies.filter((item) => item.status === "unhealthy").length;
  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="实例摘要">
        <SummaryCard
          icon={BoxIcon}
          label="版本"
          value={overview.version}
          detail={overview.environment}
        />
        <SummaryCard
          icon={ServerCogIcon}
          label="部署模式"
          value={overview.deploymentMode === "kubernetes" ? "Kubernetes" : "单机 / Compose"}
          detail={`启动于 ${formatDateTime(overview.startedAt)}`}
        />
        <SummaryCard
          icon={Clock3Icon}
          label="运行时间"
          value={formatDuration(overview.uptimeSeconds)}
          detail={
            overview.lastMigrationAt
              ? `最近迁移 ${formatDateTime(overview.lastMigrationAt)}`
              : "迁移时间未知"
          }
        />
        <SummaryCard
          icon={ActivityIcon}
          label="依赖健康"
          value={unhealthy ? `${unhealthy} 项异常` : `${healthy} 项正常`}
          detail={`${overview.dependencies.length} 项已纳入检查`}
          danger={unhealthy > 0}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>依赖与服务</CardTitle>
            <CardDescription>状态检查失败不会暴露内部地址或认证信息。</CardDescription>
            <CardAction>
              <Badge variant={unhealthy ? "destructive" : "outline"}>
                {unhealthy ? "需要处理" : "运行正常"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="-mb-(--card-spacing) divide-y px-0">
            {overview.dependencies.map((dependency) => (
              <div
                key={dependency.id}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[170px_110px_1fr_auto] sm:items-center"
              >
                <div className="flex items-center gap-2 font-medium">
                  <DatabaseIcon className="size-4 text-muted-foreground" />
                  {dependency.label}
                </div>
                <StatusBadge status={dependency.status} />
                <p className="text-sm text-muted-foreground">{dependency.detail}</p>
                <span className="font-mono text-xs text-muted-foreground">
                  {dependency.latencyMs === null ? "—" : `${dependency.latencyMs} ms`}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>数据链路</CardTitle>
            <CardDescription>用于判断数据是否仍在持续进入和落盘。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <PipelineMetric
              icon={ActivityIcon}
              label="最新事件"
              value={
                overview.pipeline.latestEventAt
                  ? formatDateTime(overview.pipeline.latestEventAt)
                  : "暂无可用数据"
              }
            />
            <PipelineMetric
              icon={RefreshCwIcon}
              label="Kafka 消费延迟"
              value={
                overview.pipeline.kafkaLag === null
                  ? "尚未接入"
                  : `${overview.pipeline.kafkaLag.toLocaleString()} 条`
              }
            />
            <PipelineMetric
              icon={TriangleAlertIcon}
              label="失败维护任务"
              value={
                overview.pipeline.failedJobs === null
                  ? "尚未接入"
                  : `${overview.pipeline.failedJobs} 个`
              }
            />
            <Capacity capacity={overview.pipeline.capacity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  danger = false,
}: {
  icon: typeof BoxIcon;
  label: string;
  value: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle className={cn("text-xl", danger && "text-destructive")}>{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: AdminOverview["dependencies"][number]["status"] }) {
  if (status === "healthy")
    return (
      <Badge variant="outline">
        <CheckCircle2Icon />
        正常
      </Badge>
    );
  if (status === "unhealthy")
    return (
      <Badge variant="destructive">
        <TriangleAlertIcon />
        异常
      </Badge>
    );
  if (status === "configured")
    return (
      <Badge variant="secondary">
        <CheckCircle2Icon />
        已配置
      </Badge>
    );
  return (
    <Badge variant="outline">
      <CircleHelpIcon />
      {status === "not_configured" ? "未配置" : "未知"}
    </Badge>
  );
}

function PipelineMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ActivityIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-md bg-muted p-2">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function Capacity({ capacity }: { capacity: AdminOverview["pipeline"]["capacity"] }) {
  const percent = capacity.usedPercent;
  const pressureLabel = {
    normal: "容量正常",
    warning: "容量偏低",
    critical: "容量紧急",
    unknown: "状态未知",
  }[capacity.pressure];
  return (
    <div className="flex flex-col gap-3">
      <Separator />
      <div className="flex items-start justify-between gap-3">
        <PipelineMetric
          icon={HardDriveIcon}
          label="ClickHouse 存储"
          value={
            percent === null
              ? "容量暂不可用"
              : `${formatBytes(capacity.usedBytes!)} / ${formatBytes(capacity.capacityBytes!)}`
          }
        />
        <Badge variant={capacity.pressure === "critical" ? "destructive" : "outline"}>
          {pressureLabel}
        </Badge>
      </div>
      {percent !== null ? (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full",
                capacity.pressure === "critical" ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>已用 {percent.toFixed(1)}%</span>
            <span>剩余 {formatBytes(capacity.freeBytes!)}</span>
          </div>
        </>
      ) : null}
      {capacity.automaticSamplingActive ? (
        <Alert variant={capacity.ingestBlocked ? "destructive" : "warning"}>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{capacity.ingestBlocked ? "数据接入已暂停" : "自动降采样已启用"}</AlertTitle>
          <AlertDescription>
            {capacity.ingestBlocked
              ? "Ingest 正在丢弃新上报，ClickHouse 降回 90% 以下后自动恢复。"
              : `Browser SDK 采样率临时限制为 ${Math.round((capacity.automaticSamplingRate ?? 0) * 100)}%，达到 95% 后暂停数据接入。`}
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="text-xs text-muted-foreground">{capacity.detail}</p>
    </div>
  );
}

function AdminOverviewSkeleton() {
  return (
    <AsyncLoading>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </AsyncLoading>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
}
function formatBytes(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "unit",
    unit: "gigabyte",
    maximumFractionDigits: 1,
  }).format(value / 1024 / 1024 / 1024);
}
