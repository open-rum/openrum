import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { GaugeIcon, InfoIcon, ShieldCheckIcon, UsersIcon } from "lucide-react";

import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getConnectionStatus, type ConnectionStatus } from "@/lib/api/client";
import {
  canManageProjects,
  getProject,
  updateProject,
  type OverLimitBehavior,
  type Project,
} from "@/lib/api/projects";
import { ProjectDataSettingsShell } from "./ProjectDataSettingsShell";

const maximumRequestsPerSecond = 1_000_000;
const maximumEventsPerRequest = 100;

export function ProjectQuotaRoute() {
  const { projectId } = useParams({ from: "/protected/settings/project/$projectId/quota" });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  const connectionStatus = useQuery({
    queryKey: ["connection-status", projectId],
    queryFn: ({ signal }) => getConnectionStatus(projectId, signal),
  });

  return (
    <ProjectDataSettingsShell projectId={projectId} section="quota">
      {project.isLoading ? (
        <AsyncLoading label="正在加载速率限制设置…" />
      ) : project.error ? (
        <AsyncError
          error={project.error}
          title="无法加载速率限制设置"
          remediation="项目可能已被删除，或你已不在该组织中。"
          onRetry={() => void project.refetch()}
        />
      ) : project.data ? (
        <RateLimitForm
          projectId={projectId}
          project={project.data}
          connectionStatus={connectionStatus.data}
        />
      ) : null}
    </ProjectDataSettingsShell>
  );
}

function RateLimitForm({
  projectId,
  project,
  connectionStatus,
}: {
  projectId: string;
  project: Project;
  connectionStatus?: ConnectionStatus;
}) {
  const queryClient = useQueryClient();
  const canManage = canManageProjects(project.role);
  const [source, setSource] = useState<"default" | "custom">(
    project.ingestRateLimit === null ? "default" : "custom",
  );
  const [limit, setLimit] = useState(
    String(project.ingestRateLimit ?? project.defaultIngestRateLimit),
  );
  const [behavior, setBehavior] = useState<OverLimitBehavior>(project.overLimitBehavior);
  const [saved, setSaved] = useState(false);

  const inheritsDefault = source === "default";
  const parsedLimit = Number(limit);
  const limitError =
    source === "custom" &&
    (limit.trim() === "" ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > maximumRequestsPerSecond)
      ? `请输入 1–${maximumRequestsPerSecond.toLocaleString("zh-CN")} 之间的整数。`
      : "";
  const effectiveLimit =
    inheritsDefault || limitError ? project.defaultIngestRateLimit : parsedLimit;
  const theoreticalEventLimit = effectiveLimit * maximumEventsPerRequest;
  const environmentCount = Math.max(project.environments?.length ?? 1, 1);

  const mutation = useMutation({
    mutationFn: () =>
      updateProject(projectId, {
        ingestRateLimit: inheritsDefault ? null : parsedLimit,
        overLimitBehavior: behavior,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["project", projectId], updated);
      setSource(updated.ingestRateLimit === null ? "default" : "custom");
      setLimit(String(updated.ingestRateLimit ?? updated.defaultIngestRateLimit));
      setBehavior(updated.overLimitBehavior);
      setSaved(true);
    },
  });
  const disabled = !canManage || mutation.isPending;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!limitError) mutation.mutate();
      }}
    >
      {!canManage ? (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>当前权限为只读</AlertTitle>
          <AlertDescription>
            当前角色为 {project.role}，只有 Owner 或 Admin 可以修改速率限制。
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="当前速率限制摘要">
        <SummaryCard
          icon={<GaugeIcon aria-hidden="true" />}
          title="当前生效上限"
          value={`${effectiveLimit.toLocaleString("zh-CN")} 请求/秒`}
          detail={inheritsDefault ? "继承 Instance 默认值" : "Project 自定义值"}
        />
        <SummaryCard
          icon={<InfoIcon aria-hidden="true" />}
          title="理论事件上限"
          value={`${theoreticalEventLimit.toLocaleString("zh-CN")} 事件/秒`}
          detail={`按每个请求最多 ${maximumEventsPerRequest} 个事件估算，不代表处理容量`}
        />
        <SummaryCard
          icon={<UsersIcon aria-hidden="true" />}
          title="共享范围"
          value={`${environmentCount} 个 Environment`}
          detail="同一 Project 下的环境共用这个上限"
        />
        <SummaryCard
          icon={<ShieldCheckIcon aria-hidden="true" />}
          title="最近限流信号"
          value={formatRateLimitSignal(connectionStatus)}
          detail="只反映最近一次 Ingest 拒绝，不是累计次数"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>请求上限</CardTitle>
          <CardDescription>
            限制按请求计数，不按事件计数。所有 DSN 和 Environment 共享 Project 上限。
          </CardDescription>
          <CardAction>
            <Badge>当前生效 {effectiveLimit.toLocaleString("zh-CN")}/秒</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldSet>
              <FieldLegend variant="label">限制来源</FieldLegend>
              <FieldDescription>
                继承默认值便于统一运维；只在项目确实需要独立流量边界时设置覆盖值。
              </FieldDescription>
              <ToggleGroup
                type="single"
                variant="selection"
                value={source}
                disabled={disabled}
                aria-label="限制来源"
                className="grid w-full max-w-xl grid-cols-2"
                onValueChange={(value) => {
                  if (value !== "default" && value !== "custom") return;
                  setSaved(false);
                  setSource(value);
                }}
              >
                <ToggleGroupItem value="default" className="min-h-10">
                  继承 Instance 默认
                </ToggleGroupItem>
                <ToggleGroupItem value="custom" className="min-h-10">
                  Project 自定义
                </ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>

            {!inheritsDefault ? (
              <Field data-invalid={Boolean(limitError)} className="max-w-sm">
                <FieldLabel htmlFor="ingest-rate-limit">每秒请求上限</FieldLabel>
                <Input
                  id="ingest-rate-limit"
                  type="number"
                  min={1}
                  max={maximumRequestsPerSecond}
                  step={1}
                  inputMode="numeric"
                  value={limit}
                  disabled={disabled}
                  aria-invalid={Boolean(limitError)}
                  onChange={(event) => {
                    setSaved(false);
                    setLimit(event.target.value);
                  }}
                />
                <FieldDescription>
                  可设置 1–{maximumRequestsPerSecond.toLocaleString("zh-CN")} 请求/秒。
                </FieldDescription>
                <FieldError>{limitError}</FieldError>
              </Field>
            ) : null}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            Instance 默认值：{project.defaultIngestRateLimit.toLocaleString("zh-CN")} 请求/秒
          </span>
          <Badge variant="outline">固定 1 秒窗口</Badge>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>超过上限时</CardTitle>
          <CardDescription>
            两种策略都会返回 HTTP 429 和 Retry-After；区别在于优先保留吞吐边界还是完整会话。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldSet>
            <FieldLegend variant="label">超限策略</FieldLegend>
            <ToggleGroup
              type="single"
              variant="selection"
              value={behavior}
              disabled={disabled}
              aria-label="超限策略"
              className="grid w-full grid-cols-1 gap-3 lg:grid-cols-2"
              onValueChange={(value) => {
                if (value !== "reject" && value !== "sample") return;
                setSaved(false);
                setBehavior(value);
              }}
            >
              <ToggleGroupItem
                value="reject"
                className="h-auto min-h-24 items-start justify-start px-4 py-3 text-left whitespace-normal"
              >
                <span className="flex flex-col gap-1">
                  <strong>精确拒绝</strong>
                  <span className="font-normal text-muted-foreground">
                    严格守住上限；先到的请求通过，其余请求被拒绝，突发期间的会话可能不完整。
                  </span>
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="sample"
                className="h-auto min-h-24 items-start justify-start px-4 py-3 text-left whitespace-normal"
              >
                <span className="flex flex-col gap-1">
                  <strong>按调用方降采样</strong>
                  <span className="font-normal text-muted-foreground">
                    稳定保留完整调用方；单窗口放行量是近似值，最坏可达到设置上限的两倍。
                  </span>
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
          </FieldSet>
        </CardContent>
      </Card>

      <Alert>
        <InfoIcon />
        <AlertTitle>部署与故障语义</AlertTitle>
        <AlertDescription>
          Redis 正常时由所有 Ingest 副本共享计数。Redis 不可用时，每个副本会以 Project
          上限的一半独立保护自己，因此集群总量不再是精确上限。修改后最多约 30 秒进入 Ingest 缓存。
        </AlertDescription>
      </Alert>

      {mutation.error ? (
        <Alert variant="destructive">
          <AlertTitle>保存失败</AlertTitle>
          <AlertDescription>
            {mutation.error instanceof Error ? mutation.error.message : "未知错误"}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || Boolean(limitError)}>
          {mutation.isPending ? "保存中…" : "保存速率限制"}
        </Button>
        {saved ? (
          <span role="status" className="flex items-center gap-2">
            <Badge>已保存</Badge>
            <span className="text-sm text-muted-foreground">新的设置将在缓存刷新后生效。</span>
          </span>
        ) : null}
      </div>
    </form>
  );
}

function SummaryCard({
  icon,
  title,
  value,
  detail,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Badge aria-hidden="true">{icon}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-semibold text-foreground">{value}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function formatRateLimitSignal(status?: ConnectionStatus) {
  if (!status) return "正在确认";
  if (status.lastRejectReason !== "RATE_LIMITED" || !status.lastRejectAt) {
    return "最近未记录";
  }
  return new Date(status.lastRejectAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
