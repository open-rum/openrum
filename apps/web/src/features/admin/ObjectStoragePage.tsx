import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CloudIcon,
  CopyIcon,
  LockKeyholeIcon,
  PencilIcon,
  PlayIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
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
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HTTPError } from "@/lib/auth/session";
import {
  objectStorageProbeSchema,
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

type StorageProviderPreset = "oss" | "aws" | "r2" | "minio" | "s3";

type StorageProviderOption = {
  label: string;
  provider: "oss" | "s3";
  description: string;
  regionPlaceholder: string;
  endpointPlaceholder: string;
  endpointRequired: boolean;
  forcePathStyle: boolean;
  accessKeyLabel: string;
  secretKeyLabel: string;
};

const providerOptions: Record<StorageProviderPreset, StorageProviderOption> = {
  oss: {
    label: "Alibaba OSS",
    provider: "oss",
    description: "使用阿里云 OSS 原生协议；标准公网 Endpoint 可根据 Region 自动解析。",
    regionPlaceholder: "cn-hangzhou",
    endpointPlaceholder: "https://oss-cn-hangzhou.aliyuncs.com",
    endpointRequired: false,
    forcePathStyle: false,
    accessKeyLabel: "OSS Access Key ID",
    secretKeyLabel: "OSS Access Key Secret",
  },
  aws: {
    label: "Amazon S3",
    provider: "s3",
    description: "使用 AWS Signature V4；标准区域 Endpoint 可以留空。",
    regionPlaceholder: "ap-southeast-1",
    endpointPlaceholder: "留空使用 AWS 默认 Endpoint",
    endpointRequired: false,
    forcePathStyle: false,
    accessKeyLabel: "AWS Access Key ID",
    secretKeyLabel: "AWS Secret Access Key",
  },
  r2: {
    label: "Cloudflare R2",
    provider: "s3",
    description: "通过 R2 的 S3-compatible Endpoint 连接。",
    regionPlaceholder: "auto",
    endpointPlaceholder: "https://<account-id>.r2.cloudflarestorage.com",
    endpointRequired: true,
    forcePathStyle: false,
    accessKeyLabel: "R2 Access Key ID",
    secretKeyLabel: "R2 Secret Access Key",
  },
  minio: {
    label: "MinIO",
    provider: "s3",
    description: "连接自托管 MinIO；默认启用 Path-style 寻址。",
    regionPlaceholder: "us-east-1",
    endpointPlaceholder: "https://minio.example.com",
    endpointRequired: true,
    forcePathStyle: true,
    accessKeyLabel: "MinIO Access Key",
    secretKeyLabel: "MinIO Secret Key",
  },
  s3: {
    label: "其他 S3-compatible",
    provider: "s3",
    description: "适用于 Ceph 及其他兼容 AWS Signature V4 的对象存储。",
    regionPlaceholder: "us-east-1",
    endpointPlaceholder: "https://storage.example.com",
    endpointRequired: true,
    forcePathStyle: true,
    accessKeyLabel: "Access Key ID",
    secretKeyLabel: "Secret Access Key",
  },
};

export function ObjectStoragePage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(objectStorageStatusQueryOptions());

  return (
    <AdminPageLayout
      title="对象存储"
      description="存放 Source Map 等构建产物。所有项目共用这一个存储，不配置也不影响核心监控。"
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
  onConfigured,
}: {
  storage: ObjectStorageStatus;
  onConfigured: () => void;
}) {
  // A configured instance leads with what is in effect; the form opens only to replace it.
  const [editing, setEditing] = useState(false);
  const [lastProbe, setLastProbe] = useState<ObjectStorageProbe>();
  const probe = useMutation({ mutationFn: testObjectStorage, onSuccess: setLastProbe });
  const showForm = !storage.configured || editing;

  return (
    <div className="flex flex-col gap-5">
      {storage.configured ? (
        <StorageOverview
          storage={storage}
          probe={lastProbe}
          testing={probe.isPending}
          testError={probe.error}
          editing={editing}
          onTest={() => probe.mutate()}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <Alert>
          <CloudIcon />
          <AlertTitle>尚未配置对象存储</AlertTitle>
          <AlertDescription>
            PV、UV、行为、错误、性能、API 监控和告警都可正常使用；只有 Source Map
            源码还原需要对象存储。
          </AlertDescription>
        </Alert>
      )}

      {showForm ? (
        <StorageConfigForm
          available={storage.managedSecretsAvailable}
          storage={storage}
          onCancel={storage.configured ? () => setEditing(false) : undefined}
          onSaved={(result) => {
            setLastProbe(result);
            setEditing(false);
            toast.success(storage.configured ? "对象存储配置已更新" : "对象存储已启用", {
              description: "约 30 秒内同步到所有 API 和 Worker 副本。",
            });
            onConfigured();
          }}
        />
      ) : null}

      <CorsHelp provider={storage.provider} />
    </div>
  );
}

function StorageOverview({
  storage,
  probe,
  testing,
  testError,
  editing,
  onTest,
  onEdit,
}: {
  storage: ObjectStorageStatus;
  probe?: ObjectStorageProbe;
  testing: boolean;
  testError: unknown;
  editing: boolean;
  onTest: () => void;
  onEdit: () => void;
}) {
  const managed = storage.credentialSource === "managed_encrypted";
  const canReplace = storage.managedSecretsAvailable;
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          当前存储
          <Badge variant={storage.deleteAllowed ? "outline" : "warning"} className="gap-1.5">
            <span
              className="project-status-dot"
              data-status={storage.deleteAllowed ? "active" : "deleting"}
              aria-hidden="true"
            />
            {storage.deleteAllowed ? "已启用" : "删除受限"}
          </Badge>
        </CardTitle>
        <CardDescription>
          {managed
            ? "由控制台加密保存；更换后约 30 秒同步到所有副本。"
            : "由部署环境配置（环境变量或运行时角色）；控制台不会显示密钥。"}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onTest} disabled={!storage.testAvailable || testing}>
            <PlayIcon data-icon="inline-start" />
            {testing ? "测试中…" : "测试连接"}
          </Button>
          {canReplace && !editing ? (
            <Button onClick={onEdit}>
              <PencilIcon data-icon="inline-start" />
              更换配置
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="服务商" value={storage.providerLabel} />
          <Fact label="Bucket" value={storage.bucket || "—"} />
          <Fact label="Region" value={storage.region || "—"} />
          <Fact label="Endpoint" value={storage.endpoint} />
          <Fact
            label="凭证"
            value={sourceLabels[storage.credentialSource]}
            secondary={storage.maskedIdentity || undefined}
          />
          <Fact
            label="已存储"
            value={
              storage.artifactCount === undefined
                ? "—"
                : `${storage.artifactCount.toLocaleString("zh-CN")} 个 Source Map`
            }
            secondary={
              storage.artifactBytes === undefined ? undefined : formatBytes(storage.artifactBytes)
            }
          />
        </dl>
        {!storage.deleteAllowed ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>当前凭证没有删除权限</AlertTitle>
            <AlertDescription>{deleteForbiddenMessage}</AlertDescription>
          </Alert>
        ) : null}
        {!canReplace ? (
          <p className="text-xs leading-5 text-muted-foreground">
            要在控制台更换配置，需在部署环境设置 <code>OPENRUM_ALLOW_MANAGED_SECRETS=true</code> 和
            32 字节 Base64 的 <code>OPENRUM_MASTER_KEY</code>；否则请修改部署环境变量。
          </p>
        ) : null}
        {testError ? (
          <AsyncError
            error={testError}
            title="无法启动测试"
            remediation="确认当前账号权限和会话后重试。"
            onRetry={onTest}
          />
        ) : null}
        {probe ? <ProbeResult probe={probe} /> : null}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value, secondary }: { label: string; value: string; secondary?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium break-all">{value}</dd>
      {secondary ? <dd className="text-xs text-muted-foreground">{secondary}</dd> : null}
    </div>
  );
}

function StorageConfigForm({
  available,
  storage,
  onCancel,
  onSaved,
}: {
  available: boolean;
  storage: ObjectStorageStatus;
  onCancel?: () => void;
  onSaved: (probe: ObjectStorageProbe) => void;
}) {
  const initialPreset: StorageProviderPreset =
    storage.provider === "oss"
      ? "oss"
      : storage.provider === "s3" && storage.endpoint.startsWith("http")
        ? "s3"
        : storage.provider === "s3"
          ? "aws"
          : "oss";
  const [preset, setPreset] = useState<StorageProviderPreset>(initialPreset);
  const [endpoint, setEndpoint] = useState(
    storage.endpoint.startsWith("http") ? storage.endpoint : "",
  );
  const [bucket, setBucket] = useState(storage.bucket);
  const [region, setRegion] = useState(storage.region);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [forcePathStyle, setForcePathStyle] = useState(
    providerOptions[initialPreset].forcePathStyle,
  );
  const [orphanConfirmed, setOrphanConfirmed] = useState(false);
  const [reauthenticationOpen, setReauthenticationOpen] = useState(false);
  const option = providerOptions[preset];
  const replacing = storage.configured;
  // Blank credentials keep the stored ones, but only for the same service.
  const canReuseCredentials =
    replacing &&
    storage.credentialSource === "managed_encrypted" &&
    option.provider === storage.provider;
  const credentialsBlank = accessKeyId.trim() === "" && secretAccessKey.trim() === "";
  const credentialsPartial =
    !credentialsBlank && (accessKeyId.trim() === "" || secretAccessKey.trim() === "");
  const storedObjects = storage.artifactCount ?? 0;
  const movesBucket =
    replacing && (bucket.trim() !== storage.bucket || option.provider !== storage.provider);
  const needsOrphanConfirmation = movesBucket && storedObjects > 0;

  const blocker = !available
    ? "需要先在部署环境启用控制台托管，才能保存"
    : region.trim() === "" || bucket.trim() === ""
      ? "请填写 Region 和 Bucket"
      : option.endpointRequired && endpoint.trim() === ""
        ? `${option.label} 需要填写 Endpoint`
        : credentialsPartial
          ? "Access Key ID 和 Secret 需要一起填写"
          : credentialsBlank && !canReuseCredentials
            ? "请填写访问凭证"
            : needsOrphanConfirmation && !orphanConfirmed
              ? "请确认更换 Bucket 的影响"
              : "";

  const save = useMutation({
    mutationFn: () =>
      putManagedObjectStorage({
        provider: option.provider,
        endpoint: endpoint.trim(),
        bucket: bucket.trim(),
        region: region.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
        forcePathStyle,
      }),
    onSuccess: (result) => {
      setAccessKeyId("");
      setSecretAccessKey("");
      onSaved(result.probe);
    },
  });

  function changePreset(value: string) {
    const nextPreset = value as StorageProviderPreset;
    setPreset(nextPreset);
    setEndpoint("");
    setAccessKeyId("");
    setSecretAccessKey("");
    setForcePathStyle(providerOptions[nextPreset].forcePathStyle);
    save.reset();
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{replacing ? "更换配置" : "配置对象存储"}</CardTitle>
        <CardDescription>
          {replacing
            ? "保存前会先用新配置测试写入和读取，通过后才替换当前配置。"
            : "选择服务商并填写连接信息。保存前会先测试写入和读取。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {!available ? (
            <Alert>
              <LockKeyholeIcon />
              <AlertTitle>控制台托管尚未启用</AlertTitle>
              <AlertDescription>
                在部署环境设置 OPENRUM_ALLOW_MANAGED_SECRETS=true 与 32 字节 Base64 的
                OPENRUM_MASTER_KEY 后，才能在这里保存配置。你仍可先查看各服务商需要的配置项。
              </AlertDescription>
            </Alert>
          ) : null}

          <FieldSet>
            <FieldLegend>1. 服务商</FieldLegend>
            <Field>
              <FieldLabel htmlFor="managed-provider" className="sr-only">
                服务商
              </FieldLabel>
              <Select value={preset} onValueChange={changePreset}>
                <SelectTrigger id="managed-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(
                      Object.entries(providerOptions) as Array<
                        [StorageProviderPreset, StorageProviderOption]
                      >
                    ).map(([value, item]) => (
                      <SelectItem key={value} value={value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{option.description}</FieldDescription>
            </Field>
          </FieldSet>

          <FieldSeparator />

          <FieldSet>
            <FieldLegend>2. 连接信息</FieldLegend>
            <div className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="managed-region">Region</FieldLabel>
                <Input
                  id="managed-region"
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  placeholder={option.regionPlaceholder}
                />
                {option.provider === "oss" ? (
                  <FieldDescription>
                    不带 oss- 前缀，例如 Endpoint oss-ap-southeast-1 对应 ap-southeast-1。
                  </FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-bucket">Bucket</FieldLabel>
                <Input
                  id="managed-bucket"
                  value={bucket}
                  onChange={(event) => {
                    setBucket(event.target.value);
                    setOrphanConfirmed(false);
                  }}
                  placeholder="openrum-artifacts"
                />
                <FieldDescription>需要先在服务商控制台创建；建议设为私有。</FieldDescription>
              </Field>
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="managed-endpoint">
                  Endpoint{option.endpointRequired ? "" : "（可选）"}
                </FieldLabel>
                <Input
                  id="managed-endpoint"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={option.endpointPlaceholder}
                  required={option.endpointRequired}
                />
                <FieldDescription>
                  {option.endpointRequired
                    ? "此服务商需要完整的 HTTPS Endpoint。"
                    : "留空时根据 Region 使用服务商默认的公网 Endpoint。"}
                </FieldDescription>
              </Field>
            </div>
            {option.provider === "s3" && preset !== "aws" ? (
              <Field orientation="horizontal">
                <div>
                  <FieldLabel htmlFor="force-path-style">Path-style 寻址</FieldLabel>
                  <FieldDescription>MinIO、Ceph 和部分兼容服务需要开启。</FieldDescription>
                </div>
                <Switch
                  id="force-path-style"
                  checked={forcePathStyle}
                  onCheckedChange={setForcePathStyle}
                />
              </Field>
            ) : null}
          </FieldSet>

          <FieldSeparator />

          <FieldSet>
            <FieldLegend>3. 访问凭证</FieldLegend>
            <FieldDescription>
              {canReuseCredentials
                ? `留空沿用当前凭证（${storage.maskedIdentity}）；填写则替换。`
                : "加密保存，保存后不会再次显示 Secret。需要读、写权限；删除权限可选。"}
            </FieldDescription>
            <FieldGroup className="md:grid md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="managed-access-key">{option.accessKeyLabel}</FieldLabel>
                <Input
                  id="managed-access-key"
                  value={accessKeyId}
                  onChange={(event) => setAccessKeyId(event.target.value)}
                  placeholder={canReuseCredentials ? "留空沿用当前凭证" : undefined}
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-secret-key">{option.secretKeyLabel}</FieldLabel>
                <Input
                  id="managed-secret-key"
                  value={secretAccessKey}
                  onChange={(event) => setSecretAccessKey(event.target.value)}
                  placeholder={canReuseCredentials ? "留空沿用当前凭证" : undefined}
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
            </FieldGroup>
          </FieldSet>

          {needsOrphanConfirmation ? (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertTitle>更换 Bucket 后，已上传的 Source Map 将无法读取</AlertTitle>
              <AlertDescription>
                <p>
                  当前 Bucket 中有 {storedObjects.toLocaleString("zh-CN")} 个 Source Map。OpenRUM
                  只记录文件路径、不记录所在 Bucket，切换后旧版本的错误无法再还原，删除时也清不掉旧
                  Bucket 中的文件。需要保留时，请先把 projects/ 下的文件原样复制到新
                  Bucket，或切换后在 CI 中重新上传。
                </p>
                <label className="mt-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--ds-primary)]"
                    checked={orphanConfirmed}
                    onChange={(event) => setOrphanConfirmed(event.target.checked)}
                  />
                  我了解影响，继续更换 Bucket
                </label>
              </AlertDescription>
            </Alert>
          ) : null}

          {save.error ? <SaveError error={save.error} /> : null}
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-xs leading-5 text-muted-foreground">
          {blocker || "保存需要重新验证 Instance Owner 身份，并写入审计日志。"}
        </p>
        <div className="flex gap-2">
          {onCancel ? (
            <Button variant="outline" onClick={onCancel} disabled={save.isPending}>
              取消
            </Button>
          ) : null}
          <Button
            onClick={() => setReauthenticationOpen(true)}
            disabled={save.isPending || blocker !== ""}
          >
            <ShieldCheckIcon data-icon="inline-start" />
            {save.isPending ? "正在测试并保存…" : "测试连接并保存"}
          </Button>
        </div>
      </CardFooter>
      <ReauthenticationDialog
        open={reauthenticationOpen}
        onOpenChange={setReauthenticationOpen}
        onConfirmed={() => save.mutateAsync()}
        title={replacing ? "确认更换对象存储配置" : "确认保存对象存储配置"}
        description="系统会先用新配置写入并读取一个测试文件，通过后才替换当前配置。"
        confirmLabel="测试并应用配置"
        confirmVariant="default"
      />
    </Card>
  );
}

/** A failed save carries the probe result (422) or a plain API error. */
function SaveError({ error }: { error: unknown }) {
  const probe =
    error instanceof HTTPError && error.status === 422
      ? objectStorageProbeSchema.safeParse(error.body).data
      : undefined;
  if (probe) return <ProbeResult probe={probe} />;
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>保存失败，当前配置未改变</AlertTitle>
      <AlertDescription>{error instanceof Error ? error.message : "请稍后重试。"}</AlertDescription>
    </Alert>
  );
}

function CorsHelp({ provider }: { provider: ObjectStorageStatus["provider"] }) {
  const origin = typeof window === "undefined" ? "https://rum.example.com" : window.location.origin;
  const s3Rule = JSON.stringify(
    [
      {
        AllowedOrigins: [origin],
        AllowedMethods: ["PUT"],
        AllowedHeaders: ["*"],
        MaxAgeSeconds: 3600,
      },
    ],
    null,
    2,
  );
  return (
    <details className="group rounded-[var(--radius-surface)] border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium">
        <span>
          控制台直传需要的跨域规则
          <span className="ml-2 font-normal text-muted-foreground">
            在发布页上传时，文件由浏览器直接传到 Bucket
          </span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 border-t border-border px-5 py-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact label="来源（Origin）" value={origin} />
          <Fact label="允许的方法" value="PUT" />
          <Fact label="允许的请求头" value="*" />
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">
          {provider === "s3"
            ? "S3 兼容存储可直接使用下面的 CORS 配置。"
            : "阿里云 OSS：在 Bucket 的「数据安全 → 跨域设置」中按上面三项新建规则。S3 兼容存储可使用下面的 CORS 配置。"}{" "}
          通过 Vite 插件或 CLI 在 CI 中上传不经过浏览器，不需要跨域规则。
        </p>
        <pre className="overflow-x-auto rounded-[var(--radius-field)] bg-muted p-3 font-mono text-xs">
          {s3Rule}
        </pre>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(s3Rule)
                .then(() => toast.success("已复制 CORS 配置"))
            }
          >
            <CopyIcon data-icon="inline-start" />
            复制 CORS 配置
          </Button>
        </div>
      </div>
    </details>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

const deleteForbiddenMessage =
  "上传和堆栈还原不受影响，可以继续使用。删除文件、版本或项目时，存储桶中的文件会保留，需要自行清理或配置生命周期规则。需要自动清理时，请为该凭证添加 DeleteObject 权限。";

function ProbeResult({ probe }: { probe: ObjectStorageProbe }) {
  const failureMessage =
    errorMessages[probe.errorCode ?? "network"] ?? "对象存储测试失败，请检查部署配置和服务日志。";
  const deleteForbidden = probe.warnings.includes("delete_forbidden");
  const limited = probe.success && probe.warnings.length > 0;
  return (
    <div className="flex flex-col gap-4">
      {limited ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>
            {deleteForbidden ? "可以使用，但没有删除权限" : "可以使用，但测试文件未能删除"}
          </AlertTitle>
          <AlertDescription>
            {deleteForbidden
              ? `写入和读取正常，删除被拒绝。${deleteForbiddenMessage}`
              : "写入和读取正常，删除测试文件时失败（可能是网络波动），可以稍后重试测试。"}{" "}
            测试文件可能留在 <code>openrum-diagnostics/connectivity/</code> 下，可手动删除。
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant={probe.success ? "default" : "destructive"}>
          {probe.success ? <CheckCircle2Icon /> : <TriangleAlertIcon />}
          <AlertTitle>{probe.success ? "对象存储连接正常" : "对象存储测试失败"}</AlertTitle>
          <AlertDescription>
            {probe.success ? `全部步骤已通过，耗时 ${probe.durationMs} ms。` : failureMessage}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-3">
        {probe.steps.map((step) => (
          <div key={step.name} className="flex items-center justify-between gap-3">
            <span className="text-sm">{stepLabels[step.name]}</span>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  step.status === "passed" ? "outline" : probe.success ? "warning" : "destructive"
                }
              >
                {step.status === "passed"
                  ? "通过"
                  : step.errorCode === "forbidden"
                    ? "无权限"
                    : "失败"}
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
