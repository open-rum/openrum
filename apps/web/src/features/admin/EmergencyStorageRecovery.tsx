import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  DatabaseZapIcon,
  HardDriveIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createEmergencyCleanupJob,
  emergencyCleanupJobQueryOptions,
  previewEmergencyCleanup,
  type EmergencyCleanupPreview,
} from "@/lib/api/admin";
import { storagePressureQueryOptions } from "@/lib/api/storagePressure";
import { sessionQueryOptions } from "@/lib/auth/session";

const confirmationText = "清理旧数据";

export function EmergencyStorageRecovery() {
  const queryClient = useQueryClient();
  const { data: user } = useSuspenseQuery(sessionQueryOptions());
  const pressure = useQuery(storagePressureQueryOptions());
  const latestJob = useQuery(emergencyCleanupJobQueryOptions());
  const [preview, setPreview] = useState<EmergencyCleanupPreview | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const autoPreviewed = useRef(false);
  const previewMutation = useMutation({
    mutationFn: previewEmergencyCleanup,
    onSuccess: setPreview,
  });
  const createMutation = useMutation({
    mutationFn: createEmergencyCleanupJob,
    onSuccess: async () => {
      setPreview(null);
      setPassword("");
      setConfirmation("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "emergency-cleanup"] }),
        queryClient.invalidateQueries({ queryKey: ["storage-pressure"] }),
      ]);
    },
  });
  const shouldAutoPreview =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("recovery") === "1";
  const pressureActive = pressure.data && !["normal", "unknown"].includes(pressure.data.mode);
  const job = latestJob.data?.job;
  const jobActive = job && ["queued", "running", "retry"].includes(job.status);
  const owner = user.instanceRole === "instance_owner";

  useEffect(() => {
    if (
      !shouldAutoPreview ||
      autoPreviewed.current ||
      !pressureActive ||
      jobActive ||
      previewMutation.isPending
    ) {
      return;
    }
    autoPreviewed.current = true;
    previewMutation.mutate();
  }, [jobActive, pressureActive, previewMutation, shouldAutoPreview]);

  const progress = job?.totalSteps ? Math.round((job.completedSteps / job.totalSteps) * 100) : 0;
  const usedPercent = pressure.data?.usedPercent;

  return (
    <Card id="emergency-storage-recovery">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseZapIcon aria-hidden="true" />
          紧急存储恢复
        </CardTitle>
        <CardDescription>
          空间不足时，OpenRUM 会推荐可安全删除的完整旧月份；释放到安全线后自动恢复数据接入。
        </CardDescription>
        <CardAction>
          {pressureActive ? (
            <Badge variant={pressure.data?.mode === "blocked" ? "destructive" : "outline"}>
              {pressure.data?.mode === "blocked" ? "接入已暂停" : "空间不足"}
            </Badge>
          ) : (
            <Badge variant="outline">当前安全</Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {jobActive && job ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">正在清理旧数据</p>
                <p className="text-sm text-muted-foreground">
                  已完成 {job.completedSteps}/{job.totalSteps} 个数据分区，完成后会重新检测空间。
                </p>
              </div>
              <Badge variant="outline">{job.status === "retry" ? "正在重试" : "处理中"}</Badge>
            </div>
            <Progress value={progress} aria-label={`紧急清理进度 ${progress}%`} />
            <div className="flex justify-between gap-4 text-xs text-muted-foreground">
              <span>预计释放 {formatBytes(job.estimatedReleaseBytes)}</span>
              <span>{progress}%</span>
            </div>
            {job.lastError ? <p className="text-sm text-destructive">{job.lastError}</p> : null}
          </div>
        ) : null}

        {!jobActive && job?.status === "completed" ? (
          <Alert>
            <CheckCircle2Icon aria-hidden="true" />
            <AlertTitle>最近一次旧数据清理已完成</AlertTitle>
            <AlertDescription>
              已处理 {job.totalSteps} 个数据分区，预计释放 {formatBytes(job.estimatedReleaseBytes)}
              。
              {pressure.data?.mode === "blocked"
                ? "系统正在重新检测空间；低于 90% 后会自动恢复接入。"
                : "数据接入状态正常。"}
            </AlertDescription>
          </Alert>
        ) : null}

        {!jobActive && job?.status === "failed" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>最近一次紧急清理未完成</AlertTitle>
            <AlertDescription>
              {job.lastError || "请重新生成方案；如果仍然失败，请先扩容 ClickHouse 磁盘。"}
            </AlertDescription>
          </Alert>
        ) : null}

        {pressureActive && !jobActive ? (
          <Alert variant={pressure.data?.mode === "blocked" ? "destructive" : "warning"}>
            <HardDriveIcon aria-hidden="true" />
            <AlertTitle>
              {pressure.data?.mode === "blocked" ? "需要释放存储空间" : "建议提前清理旧数据"}
            </AlertTitle>
            <AlertDescription>
              当前已用 {usedPercent?.toFixed(1) ?? "—"}%。系统只会选择已经结束超过 24
              小时的完整自然月，不会删除 ClickHouse 文件、近期数据或仍在进行的本月数据。
            </AlertDescription>
          </Alert>
        ) : null}

        {!pressure.isLoading && !pressureActive && !jobActive ? (
          <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
            <ShieldCheckIcon aria-hidden="true" />
            <div>
              <p className="font-medium">当前不需要紧急清理</p>
              <p className="text-sm text-muted-foreground">
                {usedPercent == null
                  ? "暂时无法读取容量；系统不会在容量未知时执行删除。"
                  : `ClickHouse 已用 ${usedPercent.toFixed(1)}%，达到 85% 后这里会提供清理方案。`}
              </p>
            </div>
          </div>
        ) : null}

        {previewMutation.error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>暂时无法生成安全清理方案</AlertTitle>
            <AlertDescription>{previewMutation.error.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          删除不可恢复；普通的保留期修改仍在下方单独管理。
        </p>
        {pressureActive && !jobActive ? (
          <Button
            type="button"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
          >
            {previewMutation.isPending ? (
              <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <DatabaseZapIcon data-icon="inline-start" />
            )}
            {previewMutation.isPending ? "正在计算…" : "生成推荐清理方案"}
          </Button>
        ) : null}
      </CardFooter>

      <AlertDialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending) {
            setPreview(null);
            setPassword("");
            setConfirmation("");
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlertIcon aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>确认清理旧数据</AlertDialogTitle>
            <AlertDialogDescription>
              这是不可恢复的操作。系统会逐个删除下列完整月份，并持续显示进度。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="当前使用率"
                  value={formatPercent(preview.usedBytes, preview.capacityBytes)}
                />
                <Metric label="预计释放" value={formatBytes(preview.estimatedReleaseBytes)} />
                <Metric
                  label="清理后预计"
                  value={formatPercent(preview.projectedUsedBytes, preview.capacityBytes)}
                  emphasized
                />
              </div>

              {!preview.canReachTarget ? (
                <Alert variant="warning">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertTitle>这些旧数据不足以降到 85%</AlertTitle>
                  <AlertDescription>
                    清理仍会释放空间，但完成后可能继续暂停接入；请同时准备扩容磁盘。
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="max-h-52 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>月份</TableHead>
                      <TableHead className="text-right">数据量</TableHead>
                      <TableHead className="text-right">预计释放</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.groups.map((group) => (
                      <TableRow key={`${group.projectId}:${group.month}`}>
                        <TableCell className="font-medium">{group.projectName}</TableCell>
                        <TableCell>{formatMonth(group.month)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {group.affectedRows.toLocaleString("zh-CN")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBytes(group.estimatedBytes)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {owner ? (
                <FieldGroup>
                  <Field data-invalid={Boolean(createMutation.error)}>
                    <FieldLabel htmlFor="emergency-cleanup-confirmation">
                      输入“{confirmationText}”确认
                    </FieldLabel>
                    <Input
                      id="emergency-cleanup-confirmation"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      aria-invalid={Boolean(createMutation.error)}
                      autoComplete="off"
                    />
                  </Field>
                  <Field data-invalid={Boolean(createMutation.error)}>
                    <FieldLabel htmlFor="emergency-cleanup-password">当前密码</FieldLabel>
                    <Input
                      id="emergency-cleanup-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-invalid={Boolean(createMutation.error)}
                      autoComplete="current-password"
                    />
                    <FieldDescription>只有 Instance Owner 可以执行数据删除。</FieldDescription>
                  </Field>
                </FieldGroup>
              ) : (
                <Alert>
                  <ShieldCheckIcon aria-hidden="true" />
                  <AlertTitle>需要 Instance Owner 确认</AlertTitle>
                  <AlertDescription>
                    你可以查看方案，但不能执行不可恢复的数据删除。
                  </AlertDescription>
                </Alert>
              )}

              {createMutation.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {createMutation.error.message}
                </p>
              ) : null}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createMutation.isPending}>取消</AlertDialogCancel>
            {owner ? (
              <AlertDialogAction
                variant="destructive"
                disabled={
                  confirmation !== confirmationText || !password || createMutation.isPending
                }
                onClick={(event) => {
                  event.preventDefault();
                  if (!preview) return;
                  createMutation.mutate({
                    previewToken: preview.previewToken,
                    confirmation,
                    currentPassword: password,
                  });
                }}
              >
                {createMutation.isPending ? (
                  <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                ) : null}
                {createMutation.isPending ? "正在创建任务…" : "确认并开始清理"}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Metric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={
        emphasized
          ? "rounded-lg border border-primary/50 bg-primary/10 p-4"
          : "rounded-lg border bg-muted/20 p-4"
      }
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function formatPercent(used: number, capacity: number) {
  return `${((used / capacity) * 100).toFixed(1)}%`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function formatMonth(month: number) {
  const value = String(month);
  return `${value.slice(0, 4)} 年 ${Number(value.slice(4))} 月`;
}
