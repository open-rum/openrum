import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CloudIcon,
  DatabaseIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  PlayIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  objectStorageStatusQueryOptions,
  putManagedObjectStorage,
  testObjectStorage,
  type ObjectStorageProbe,
  type ObjectStorageStatus,
} from "@/lib/api/admin";
import { AdminPageLayout } from "./AdminPageLayout";
import { ReauthenticationDialog } from "./ReauthenticationDialog";

const sourceLabels: Record<ObjectStorageStatus["credentialSource"], string> = {
  none: "未配置",
  ram_role: "RAM Role",
  iam_role: "IAM Role / Workload Identity",
  environment: "环境变量",
  kubernetes_secret: "Kubernetes Secret",
  managed_encrypted: "控制台托管",
};

const stepLabels: Record<ObjectStorageProbe["steps"][number]["name"], string> = {
  write: "写入诊断对象",
  read: "读取并校验内容",
  delete: "删除诊断对象",
};

const errorMessages: Record<string, string> = {
  credentials: "没有取得有效凭证。请绑定 RAM Role，或由部署系统注入 OSS Key。",
  forbidden: "当前身份缺少诊断前缀的读写删除权限。",
  bucket_not_found: "Bucket 不存在，或当前身份无法访问。",
  timeout: "连接 OSS 超时，请检查网络出口、Endpoint 和安全组。",
  integrity: "写入后读取的内容不一致。",
  cleanup_failed: "测试对象未能删除，请检查 DeleteObject 权限并清理诊断前缀。",
  incompatible_endpoint:
    "当前 Endpoint 与所选 Provider 的签名或寻址方式不兼容，请检查 Provider 和 Path-style 设置。",
  network: "无法连接对象存储，请检查 Endpoint 和网络出口。",
};

export function ObjectStoragePage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(objectStorageStatusQueryOptions());
  const probe = useMutation({ mutationFn: testObjectStorage });

  return (
    <AdminPageLayout
      title="对象存储"
      description="选择 Alibaba OSS 或 S3-compatible 存储；不配置也不影响核心监控能力。"
    >
      {statusQuery.isLoading ? <AsyncLoading /> : null}
      {statusQuery.error ? (
        <AsyncError
          error={statusQuery.error}
          title="无法读取对象存储状态"
          remediation="检查实例管理员权限和 API 服务。"
          onRetry={() => void statusQuery.refetch()}
        />
      ) : null}
      {statusQuery.data ? (
        <StorageContent
          storage={statusQuery.data}
          probe={probe.data}
          testing={probe.isPending}
          testError={probe.error}
          onTest={() => probe.mutate()}
          onConfigured={() =>
            void queryClient.invalidateQueries({ queryKey: ["admin", "object-storage"] })
          }
        />
      ) : null}
    </AdminPageLayout>
  );
}

function StorageContent({
  storage,
  probe,
  testing,
  testError,
  onTest,
  onConfigured,
}: {
  storage: ObjectStorageStatus;
  probe?: ObjectStorageProbe;
  testing: boolean;
  testError: unknown;
  onTest: () => void;
  onConfigured: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {storage.credentialSource === "ram_role" || storage.credentialSource === "iam_role" ? (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>无需配置静态访问密钥</AlertTitle>
          <AlertDescription>
            当前将使用运行环境的{" "}
            {storage.credentialSource === "ram_role" ? "RAM Role" : "IAM Role / Workload Identity"}{" "}
            获取临时凭证。
          </AlertDescription>
        </Alert>
      ) : null}
      {!storage.configured ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>对象存储为可选能力</AlertTitle>
          <AlertDescription>
            PV、UV、行为、错误、性能和 API 监控均可正常使用；仅 Source Map 源码还原和后续 Session
            Replay 大对象不可用。
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.7fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>部署配置</CardTitle>
            <CardDescription>以下字段只读，修改后需要重新部署服务。</CardDescription>
            <CardAction>
              <Badge variant={storage.configured ? "outline" : "destructive"}>
                {storage.configured ? "已配置" : "未配置"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            <ConfigRow
              icon={CloudIcon}
              label="Provider"
              value={storage.providerLabel}
              secondary={
                storage.provider === "none"
                  ? "设置 OBJECT_STORAGE_PROVIDER=oss 或 s3 后启用"
                  : storage.provider === "oss"
                    ? "Alibaba OSS 原生协议"
                    : "Amazon S3、MinIO、R2、Ceph 等"
              }
            />
            <Separator />
            <ConfigRow
              icon={DatabaseIcon}
              label="Region / Bucket"
              value={storage.configured ? `${storage.region} / ${storage.bucket}` : "—"}
            />
            <Separator />
            <ConfigRow icon={CloudIcon} label="Endpoint" value={storage.endpoint} />
            <Separator />
            <ConfigRow
              icon={KeyRoundIcon}
              label="凭证来源"
              value={
                storage.credentialSource === "none"
                  ? sourceLabels.none
                  : `${sourceLabels[storage.credentialSource]} · ${storage.managedBy}`
              }
              secondary={storage.maskedIdentity || "不保存长期 Key"}
            />
            <Separator />
            <ConfigRow
              icon={ShieldCheckIcon}
              label="诊断前缀"
              value={storage.diagnosticPrefix}
              secondary="测试结束后始终尝试删除"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>安全连通性测试</CardTitle>
            <CardDescription>依次执行写入、读取校验与删除，不使用业务对象路径。</CardDescription>
            <CardAction>
              <Button onClick={onTest} disabled={!storage.testAvailable || testing}>
                <PlayIcon data-icon="inline-start" />
                {!storage.testAvailable ? "未配置" : testing ? "测试中…" : "开始测试"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {testing ? (
              <AsyncLoading label="正在测试对象存储">
                <Skeleton className="h-20" />
              </AsyncLoading>
            ) : null}
            {testError ? (
              <AsyncError
                error={testError}
                title="无法启动测试"
                remediation="确认当前账号权限和 CSRF 会话后重试。"
                onRetry={onTest}
              />
            ) : null}
            {!testing && !testError && !probe ? (
              <p className="text-sm text-muted-foreground">
                尚未执行测试。测试对象使用随机名称，内容不包含业务数据。
              </p>
            ) : null}
            {probe ? <ProbeResult probe={probe} /> : null}
          </CardContent>
        </Card>
      </div>
      <ManagedStorageCard available={storage.managedSecretsAvailable} onConfigured={onConfigured} />
    </div>
  );
}

function ManagedStorageCard({
  available,
  onConfigured,
}: {
  available: boolean;
  onConfigured: () => void;
}) {
  const [provider, setProvider] = useState<"oss" | "s3">("oss");
  const [endpoint, setEndpoint] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [forcePathStyle, setForcePathStyle] = useState(false);
  const [reauthenticationOpen, setReauthenticationOpen] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      putManagedObjectStorage({
        provider,
        endpoint,
        bucket,
        region,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
      }),
    onSuccess: () => {
      setSecretAccessKey("");
      onConfigured();
    },
  });
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>控制台托管凭证</CardTitle>
        <CardDescription>
          可选功能。候选配置会先完成隔离的写入、读取和删除测试，全部通过后才替换当前加密记录。
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {!available ? (
          <Alert>
            <LockKeyholeIcon />
            <AlertTitle>部署方尚未授权托管 Secret</AlertTitle>
            <AlertDescription>
              如需启用，请通过 Kubernetes Secret 或环境变量设置 OPENRUM_ALLOW_MANAGED_SECRETS=true
              与 32 字节 Base64 OPENRUM_MASTER_KEY。推荐生产环境继续使用 RAM/IAM Role。
            </AlertDescription>
          </Alert>
        ) : (
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="managed-provider">Provider</FieldLabel>
                <Select
                  value={provider}
                  onValueChange={(value) => setProvider(value as "oss" | "s3")}
                >
                  <SelectTrigger id="managed-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oss">Alibaba OSS</SelectItem>
                    <SelectItem value="s3">S3-compatible</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-region">Region</FieldLabel>
                <Input
                  id="managed-region"
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  placeholder="cn-shanghai"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-bucket">Bucket</FieldLabel>
                <Input
                  id="managed-bucket"
                  value={bucket}
                  onChange={(event) => setBucket(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-endpoint">Endpoint（可选）</FieldLabel>
                <Input
                  id="managed-endpoint"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://…"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-access-key">Access Key ID</FieldLabel>
                <Input
                  id="managed-access-key"
                  value={accessKeyId}
                  onChange={(event) => setAccessKeyId(event.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-secret-key">Secret Access Key</FieldLabel>
                <Input
                  id="managed-secret-key"
                  value={secretAccessKey}
                  onChange={(event) => setSecretAccessKey(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
            </div>
            {provider === "s3" ? (
              <Field orientation="horizontal">
                <div>
                  <FieldLabel htmlFor="force-path-style">Force path-style</FieldLabel>
                  <FieldDescription>MinIO、Ceph 和部分兼容服务通常需要开启。</FieldDescription>
                </div>
                <Switch
                  id="force-path-style"
                  checked={forcePathStyle}
                  onCheckedChange={setForcePathStyle}
                />
              </Field>
            ) : null}
            <div>
              <Button
                onClick={() => setReauthenticationOpen(true)}
                disabled={save.isPending || !bucket || !region || !accessKeyId || !secretAccessKey}
              >
                {save.isPending ? "正在验证并轮换…" : "验证并原子轮换"}
              </Button>
              {save.data ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  已切换到加密配置版本 {save.data.version}，主密钥版本 {save.data.keyId}。
                </p>
              ) : null}
            </div>
            <ReauthenticationDialog
              open={reauthenticationOpen}
              onOpenChange={setReauthenticationOpen}
              onConfirmed={() => save.mutateAsync()}
              title="确认轮换对象存储凭证"
              description="候选凭证测试通过后会立即替换运行时配置。请重新验证 Instance Owner 身份。"
              confirmLabel="验证并原子轮换"
            />
          </FieldGroup>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigRow({
  icon: Icon,
  label,
  value,
  secondary,
}: {
  icon: typeof CloudIcon;
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[180px_1fr]">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <div>
        <p className="text-sm font-medium break-all">{value}</p>
        {secondary ? <p className="mt-1 text-xs text-muted-foreground">{secondary}</p> : null}
      </div>
    </div>
  );
}

function ProbeResult({ probe }: { probe: ObjectStorageProbe }) {
  const failureMessage =
    errorMessages[probe.errorCode ?? "network"] ?? "对象存储测试失败，请检查部署配置和服务日志。";
  return (
    <div className="flex flex-col gap-4">
      <Alert variant={probe.success ? "default" : "destructive"}>
        {probe.success ? <CheckCircle2Icon /> : <TriangleAlertIcon />}
        <AlertTitle>{probe.success ? "对象存储连接正常" : "对象存储测试失败"}</AlertTitle>
        <AlertDescription>
          {probe.success ? `全部步骤已通过，耗时 ${probe.durationMs} ms。` : failureMessage}
        </AlertDescription>
      </Alert>
      <div className="flex flex-col gap-3">
        {probe.steps.map((step) => (
          <div key={step.name} className="flex items-center justify-between gap-3">
            <span className="text-sm">{stepLabels[step.name]}</span>
            <div className="flex items-center gap-2">
              <Badge variant={step.status === "passed" ? "outline" : "destructive"}>
                {step.status === "passed" ? "通过" : "失败"}
              </Badge>
              <span className="w-14 text-right font-mono text-xs text-muted-foreground">
                {step.latencyMs} ms
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
