import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  DatabaseZapIcon,
  HardDriveIcon,
  HistoryIcon,
  LockKeyholeIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminConfigurationQueryOptions,
  createRetentionJob,
  maintenanceJobsQueryOptions,
  previewRetention,
  updateAdminSetting,
  type AdminSetting,
  type RetentionPreview,
} from "@/lib/api/admin";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { AdminPageLayout } from "./AdminPageLayout";
import { ReauthenticationDialog } from "./ReauthenticationDialog";

const definitions = {
  rawDays: {
    label: "原始事件",
    description: "行为、错误、性能与 API 请求的逐条事件。",
    min: 1,
    max: 90,
    icon: DatabaseZapIcon,
  },
  aggregateDays: {
    label: "聚合指标",
    description: "趋势、分布、Issue 和 API 的分钟级聚合。",
    min: 1,
    max: 730,
    icon: ArchiveIcon,
  },
  sourceMapDays: {
    label: "Source Map",
    description: "0 表示跟随 Release 生命周期，不自动删除。",
    min: 0,
    max: 3650,
    icon: HardDriveIcon,
  },
} as const;

type RetentionKey = keyof typeof definitions;
const retentionKeys = Object.keys(definitions) as RetentionKey[];

export function DataRetentionPage() {
  const queryClient = useQueryClient();
  const configuration = useQuery(adminConfigurationQueryOptions());
  const projects = useQuery({
    queryKey: ["admin", "retention-projects"],
    queryFn: async () => {
      const organizations = await listOrganizations();
      const groups = await Promise.all(
        organizations.organizations.map((item) => listProjects(item.id)),
      );
      return groups
        .flatMap((group) => group.projects)
        .filter((project) => project.status === "active");
    },
  });
  const jobs = useQuery(maintenanceJobsQueryOptions());
  const settings = useMemo(
    () =>
      new Map(
        configuration.data?.settings
          .filter((item) => item.namespace === "retention")
          .map((item) => [item.key, item]),
      ),
    [configuration.data],
  );
  const [drafts, setDrafts] = useState<Partial<Record<RetentionKey, number>>>({});
  const values = Object.fromEntries(
    retentionKeys.map((key) => [
      key,
      drafts[key] ??
        settings.get(key)?.effectiveValue ??
        (key === "rawDays" ? 14 : key === "aggregateDays" ? 90 : 0),
    ]),
  ) as Record<RetentionKey, number>;
  const [projectSelection, setProjectSelection] = useState("");
  const selectedProjectId = projectSelection || projects.data?.[0]?.id || "";
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [password, setPassword] = useState("");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const hasInvalidValue = retentionKeys.some(
    (key) => values[key] < definitions[key].min || values[key] > definitions[key].max,
  );
  const hasChanges = retentionKeys.some((key) => {
    const setting = settings.get(key);
    return setting && !setting.locked && setting.effectiveValue !== values[key];
  });

  const save = useMutation({
    mutationFn: async () => {
      for (const key of retentionKeys) {
        const setting = settings.get(key);
        if (setting && !setting.locked && setting.effectiveValue !== values[key]) {
          await updateAdminSetting({
            namespace: "retention",
            key,
            value: values[key],
            expectedVersion: setting.version,
          });
        }
      }
    },
    onSuccess: async () => {
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: ["admin", "configuration"] });
    },
  });
  const previewMutation = useMutation({
    mutationFn: () => {
      const project = projects.data?.find((item) => item.id === selectedProjectId);
      if (!project) throw new Error("请先选择一个 Project。");
      return previewRetention({
        projectId: project.id,
        rawDays: project.retentionDays,
        aggregateDays: values.aggregateDays,
      });
    },
    onSuccess: setPreview,
  });
  const runJob = useMutation({
    mutationFn: () =>
      createRetentionJob({ previewToken: preview?.previewToken ?? "", currentPassword: password }),
    onSuccess: async () => {
      setPreview(null);
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "maintenance-jobs"] });
    },
  });

  const loadError = configuration.error ?? projects.error;
  return (
    <AdminPageLayout
      title="数据生命周期"
      description="统一管理 Instance 默认保留期，并在确认影响后逐月处理历史数据。"
    >
      {configuration.isLoading || projects.isLoading ? <AsyncLoading /> : null}
      {loadError ? (
        <AsyncError
          error={loadError}
          title="无法读取数据生命周期配置"
          remediation="检查实例管理员权限和数据库连接。"
          onRetry={() => void Promise.all([configuration.refetch(), projects.refetch()])}
        />
      ) : null}
      {configuration.data ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-5">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Instance 默认策略</CardTitle>
                <CardDescription>
                  Deployment 锁定的字段需修改环境变量；其余字段保存后只影响新数据。
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <FieldGroup>
                  {retentionKeys.map((key) => {
                    const definition = definitions[key];
                    const setting = settings.get(key);
                    const Icon = definition.icon;
                    return (
                      <Field
                        key={key}
                        orientation="responsive"
                        data-disabled={setting?.locked || undefined}
                      >
                        <div className="flex min-w-56 items-start gap-3">
                          <span className="rounded-md border bg-muted p-2">
                            <Icon className="size-4" />
                          </span>
                          <div>
                            <FieldLabel htmlFor={key}>{definition.label}</FieldLabel>
                            <FieldDescription>{definition.description}</FieldDescription>
                          </div>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          <Input
                            id={key}
                            className="w-28"
                            type="number"
                            min={definition.min}
                            max={definition.max}
                            value={values[key]}
                            disabled={setting?.locked}
                            aria-invalid={
                              values[key] < definition.min || values[key] > definition.max
                            }
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [key]: Number(event.target.value),
                              }))
                            }
                          />
                          <span className="text-sm text-muted-foreground">天</span>
                          <SourceBadge setting={setting} />
                        </div>
                      </Field>
                    );
                  })}
                </FieldGroup>
                <div className="mt-6 flex items-center justify-between gap-4 border-t pt-4">
                  <p className="text-xs text-muted-foreground">
                    缩短保留期不会自动删除历史数据，需先生成影响预览。
                  </p>
                  <Button
                    onClick={() => setSaveDialogOpen(true)}
                    disabled={save.isPending || hasInvalidValue || !hasChanges}
                  >
                    {save.isPending ? "保存中…" : "保存默认策略"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle>Project 策略与历史数据</CardTitle>
                <CardDescription>
                  原始事件保留期来自 Project 设置；聚合与 Source Map 默认继承 Instance 策略。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <Field>
                  <FieldLabel htmlFor="retention-project">选择 Project</FieldLabel>
                  <Select value={selectedProjectId} onValueChange={setProjectSelection}>
                    <SelectTrigger id="retention-project">
                      <SelectValue placeholder="选择 Project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.data?.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name} · {project.environment}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>预览只读取统计信息，不修改事件。</FieldDescription>
                </Field>
                <ProjectPolicy
                  project={projects.data?.find((item) => item.id === selectedProjectId)}
                  aggregateDays={values.aggregateDays}
                  sourceMapDays={values.sourceMapDays}
                />
                <Alert>
                  <TriangleAlertIcon />
                  <AlertTitle>先保存策略，再决定是否处理历史数据</AlertTitle>
                  <AlertDescription>
                    延长保留期无法恢复已删除的数据；缩短保留期会产生不可逆删除。历史清理按
                    Project、月份串行执行，并限制全局并发。
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  onClick={() => previewMutation.mutate()}
                  disabled={!selectedProjectId || previewMutation.isPending}
                >
                  {previewMutation.isPending ? "估算中…" : "生成历史影响预览"}
                </Button>
                {previewMutation.error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {previewMutation.error.message}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
          <MaintenanceJobs
            jobs={jobs.data?.jobs ?? []}
            loading={jobs.isLoading}
            error={jobs.error}
          />
        </div>
      ) : null}
      <RetentionDialog
        preview={preview}
        password={password}
        setPassword={setPassword}
        running={runJob.isPending}
        error={runJob.error}
        onOpenChange={(open) => !open && setPreview(null)}
        onConfirm={() => runJob.mutate()}
      />
      <ReauthenticationDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onConfirmed={() => save.mutateAsync()}
        title="确认修改数据生命周期"
        description="该修改影响整个 Instance 的新数据。请重新验证 Instance Owner 身份。"
        confirmLabel="验证并保存"
      />
    </AdminPageLayout>
  );
}

function SourceBadge({ setting }: { setting?: AdminSetting }) {
  if (!setting) return null;
  const labels = {
    default: "内置默认",
    instance: "Instance",
    project: "Project",
    deployment: "Deployment",
  };
  return (
    <Badge variant="outline">
      {setting.locked ? <LockKeyholeIcon className="size-3" /> : null}
      {labels[setting.source]}
    </Badge>
  );
}

function ProjectPolicy({
  project,
  aggregateDays,
  sourceMapDays,
}: {
  project?: Project;
  aggregateDays: number;
  sourceMapDays: number;
}) {
  if (!project) return <p className="text-sm text-muted-foreground">暂无可用 Project。</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        ["原始事件", `${project.retentionDays} 天`, "Project override"],
        ["聚合指标", `${aggregateDays} 天`, "继承 Instance"],
        [
          "Source Map",
          sourceMapDays === 0 ? "跟随 Release" : `${sourceMapDays} 天`,
          "继承 Instance",
        ],
      ].map(([label, value, source]) => (
        <div key={label} className="rounded-lg border bg-muted/20 p-4">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{source}</p>
        </div>
      ))}
    </div>
  );
}

function MaintenanceJobs({
  jobs,
  loading,
  error,
}: {
  jobs: import("@/lib/api/admin").MaintenanceJob[];
  loading: boolean;
  error: Error | null;
}) {
  return (
    <Card className="h-fit">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4" />
          后台维护任务
        </CardTitle>
        <CardDescription>正在运行的任务每 3 秒刷新。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {loading ? <AsyncLoading /> : null}
        {error ? (
          <AsyncError
            error={error}
            title="无法读取维护任务"
            remediation="确认 API 与 PostgreSQL 可用后重试。"
          />
        ) : null}
        {!loading && jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚无历史数据维护任务。</p>
        ) : null}
        {jobs.map((job) => {
          const progress = job.totalSteps
            ? Math.round((job.completedSteps / job.totalSteps) * 100)
            : 0;
          return (
            <div key={job.id} className="space-y-2 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Project {job.projectId.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">
                    原始 {job.rawDays} 天 · 聚合 {job.aggregateDays} 天
                  </p>
                </div>
                <Badge variant={job.status === "failed" ? "destructive" : "outline"}>
                  {job.status}
                </Badge>
              </div>
              <Progress value={progress} aria-label={`任务进度 ${progress}%`} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {job.completedSteps}/{job.totalSteps} 批
                </span>
                <span>{progress}%</span>
              </div>
              {job.lastError ? <p className="text-xs text-destructive">{job.lastError}</p> : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function RetentionDialog({
  preview,
  password,
  setPassword,
  running,
  error,
  onOpenChange,
  onConfirm,
}: {
  preview: RetentionPreview | null;
  password: string;
  setPassword: (value: string) => void;
  running: boolean;
  error: Error | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>确认处理历史数据</DialogTitle>
          <DialogDescription>
            预览令牌在 {preview ? new Date(preview.expiresAt).toLocaleTimeString("zh-CN") : "—"}{" "}
            前有效，只能使用一次。
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="space-y-4">
            <Alert variant={preview.cannotRestoreDeletedData ? "destructive" : "default"}>
              <TriangleAlertIcon />
              <AlertTitle>
                {preview.cannotRestoreDeletedData ? "包含不可逆删除" : "只更新数据到期时间"}
              </AlertTitle>
              <AlertDescription>
                影响 {preview.affectedRows.toLocaleString("zh-CN")} 行，其中预计删除{" "}
                {preview.deleteRows.toLocaleString("zh-CN")} 行，共 {preview.steps.length}{" "}
                个按月步骤。
              </AlertDescription>
            </Alert>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="retention-password">当前密码</FieldLabel>
              <Input
                id="retention-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(error)}
              />
              <FieldDescription>危险操作需要重新验证 Instance Owner 身份。</FieldDescription>
            </Field>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error.message}
              </p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={!password || running} onClick={onConfirm}>
            {running ? "正在创建…" : "确认并创建任务"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
