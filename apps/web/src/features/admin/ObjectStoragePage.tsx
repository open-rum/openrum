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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

      <ManagedStorageCard
        available={storage.managedSecretsAvailable}
        storage={storage}
        onConfigured={onConfigured}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.7fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>当前生效配置</CardTitle>
            <CardDescription>
              {storage.credentialSource === "managed_encrypted"
                ? "配置由控制台加密托管，可在上方完成安全轮换。"
                : "部署环境和运行时角色配置只读，不会在控制台回显 Secret。"}
            </CardDescription>
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
                  ? "尚未连接，可使用上方配置向导启用"
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
    </div>
  );
}

function ManagedStorageCard({
  available,
  storage,
  onConfigured,
}: {
  available: boolean;
  storage: ObjectStorageStatus;
  onConfigured: () => void;
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
  const [reauthenticationOpen, setReauthenticationOpen] = useState(false);
  const option = providerOptions[preset];
  const endpointMissing = option.endpointRequired && endpoint.trim() === "";
  const canSave =
    available &&
    bucket.trim() !== "" &&
    region.trim() !== "" &&
    accessKeyId.trim() !== "" &&
    secretAccessKey.trim() !== "" &&
    !endpointMissing;
  const save = useMutation({
    mutationFn: () =>
      putManagedObjectStorage({
        provider: option.provider,
        endpoint: endpoint.trim(),
        bucket: bucket.trim(),
        region: region.trim(),
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
      }),
    onSuccess: () => {
      setAccessKeyId("");
      setSecretAccessKey("");
      onConfigured();
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
        <CardTitle>配置对象存储</CardTitle>
        <CardDescription>
          选择 Provider 并填写连接信息。保存前会先完成写入、读取和删除验证。
        </CardDescription>
        <CardAction>
          <Badge variant={available ? "outline" : "secondary"}>
            {available ? "页面配置已启用" : "需要启用安全存储"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {!available ? (
            <Alert>
              <LockKeyholeIcon />
              <AlertTitle>页面保存功能尚未启用</AlertTitle>
              <AlertDescription>
                如需启用，请通过 Kubernetes Secret 或环境变量设置 OPENRUM_ALLOW_MANAGED_SECRETS=true
                与 32 字节 Base64 OPENRUM_MASTER_KEY。你仍可先查看和填写下面的配置项。
              </AlertDescription>
            </Alert>
          ) : null}

          <FieldSet>
            <FieldLegend>1. 选择 Provider</FieldLegend>
            <FieldDescription>选择具体服务后，表单只展示该服务需要的配置。</FieldDescription>
            <Field>
              <FieldLabel htmlFor="managed-provider">Provider</FieldLabel>
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
            <FieldDescription>
              Bucket 和 Region 必填；标准 OSS、S3 可自动选择 Endpoint。
            </FieldDescription>
            <div className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="managed-region">Region</FieldLabel>
                <Input
                  id="managed-region"
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  placeholder={option.regionPlaceholder}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-bucket">Bucket</FieldLabel>
                <Input
                  id="managed-bucket"
                  value={bucket}
                  onChange={(event) => setBucket(event.target.value)}
                  placeholder="openrum-artifacts"
                />
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
                    ? "此 Provider 需要完整的 HTTPS Endpoint。"
                    : "留空时根据 Region 使用服务商默认 Endpoint。"}
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
              Access Key 加密保存；Secret 保存成功后不会再次显示。
            </FieldDescription>
            <FieldGroup className="md:grid md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="managed-access-key">{option.accessKeyLabel}</FieldLabel>
                <Input
                  id="managed-access-key"
                  value={accessKeyId}
                  onChange={(event) => setAccessKeyId(event.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="managed-secret-key">{option.secretKeyLabel}</FieldLabel>
                <Input
                  id="managed-secret-key"
                  value={secretAccessKey}
                  onChange={(event) => setSecretAccessKey(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
            </FieldGroup>
          </FieldSet>

          {save.data ? <ProbeResult probe={save.data.probe} /> : null}
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">连接测试通过后才会应用配置</p>
          <p className="text-xs text-muted-foreground">
            保存需要重新验证 Instance Owner 身份，并写入审计日志。
          </p>
        </div>
        <Button onClick={() => setReauthenticationOpen(true)} disabled={save.isPending || !canSave}>
          <ShieldCheckIcon data-icon="inline-start" />
          {!available
            ? "启用安全存储后可保存"
            : save.isPending
              ? "正在测试并保存…"
              : "测试连接并保存"}
        </Button>
      </CardFooter>
      <ReauthenticationDialog
        open={reauthenticationOpen}
        onOpenChange={setReauthenticationOpen}
        onConfirmed={() => save.mutateAsync()}
        title="确认保存对象存储配置"
        description="系统将使用候选凭证执行写入、读取和删除测试；全部通过后才替换当前配置。"
        confirmLabel="测试并应用配置"
        confirmVariant="default"
      />
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
