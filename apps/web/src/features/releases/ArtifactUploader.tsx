import { useState } from "react";
import { FileUpIcon, FolderUpIcon, RefreshCwIcon, UploadCloudIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { Release } from "@/lib/api/releases";
import { formatBytes } from "./format";
import {
  artifactNameFor,
  normalizeUrlPrefix,
  selectedFilesFrom,
  type summarizeUploads,
  type SelectedFile,
  type UploadItem,
  type UploadStatus,
} from "./uploadQueue";
import { useArtifactUpload } from "./useArtifactUpload";

const EXAMPLE_PATH = "assets/index-abc123.js.map";

const statusLabels: Record<UploadStatus, string> = {
  waiting: "等待中",
  hashing: "计算校验和",
  uploading: "上传中",
  verifying: "服务端校验",
  ready: "可用",
  skipped: "已跳过（内容相同）",
  failed: "失败",
};

export function ArtifactUploader({
  projectId,
  release,
  disabledReason,
  maxBytes,
  remapWindowDays,
}: {
  projectId: string;
  release: Release;
  /** Set when uploads cannot work (e.g. storage not configured); disables the pickers. */
  disabledReason?: string;
  maxBytes?: number;
  remapWindowDays: number;
}) {
  const [prefix, setPrefix] = useState("");
  const [selection, setSelection] = useState<{ files: SelectedFile[]; ignored: number }>();
  const upload = useArtifactUpload(projectId, release.id, maxBytes);
  const started = upload.items.length > 0;
  const disabled = Boolean(disabledReason) || upload.busy;
  const normalizedPrefix = normalizeUrlPrefix(prefix);

  function pick(list: FileList | null) {
    if (!list?.length) return;
    upload.clear();
    setSelection(selectedFilesFrom(list));
  }

  return (
    <section className="artifact-uploader" aria-label="上传 Source Map">
      <div className="artifact-uploader__prefix">
        <label>
          <span>URL 路径前缀</span>
          <Input
            value={prefix}
            placeholder="例如 static/app/，站点根目录留空"
            disabled={upload.busy}
            onChange={(event) => setPrefix(event.target.value)}
          />
        </label>
        <p>
          脚本 URL 中域名之后、构建目录之前的部分。匹配名 = 前缀 + 文件在构建目录中的相对路径，例如
          脚本 <code>https://cdn.example.com/{normalizedPrefix}assets/index-abc123.js</code> 对应{" "}
          <code data-testid="artifact-name-example">{artifactNameFor(EXAMPLE_PATH, prefix)}</code>。
        </p>
      </div>

      <div className="artifact-drop">
        <UploadCloudIcon />
        <span>
          <strong>选择构建目录或 .map 文件</strong>
          <small>
            选择文件夹时会保留子目录结构，只上传其中的 .map 文件；单个文件上限{" "}
            {Math.floor((maxBytes ?? 64 * 1024 * 1024) / 1024 / 1024)} MiB。
          </small>
          {disabledReason ? (
            <small className="artifact-drop__blocked">{disabledReason}</small>
          ) : null}
        </span>
        <div className="artifact-drop__actions">
          <Button asChild variant="outline" aria-disabled={disabled || undefined}>
            <label className={disabled ? "pointer-events-none opacity-50" : undefined}>
              <FolderUpIcon />
              选择文件夹
              <input
                className="sr-only"
                type="file"
                aria-label="选择构建目录"
                disabled={disabled}
                ref={(node) => node?.setAttribute("webkitdirectory", "")}
                onChange={(event) => {
                  pick(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </Button>
          <Button asChild variant="outline" aria-disabled={disabled || undefined}>
            <label className={disabled ? "pointer-events-none opacity-50" : undefined}>
              <FileUpIcon />
              选择文件
              <input
                className="sr-only"
                type="file"
                multiple
                accept=".map,application/json"
                aria-label="选择 Source Map 文件"
                disabled={disabled}
                onChange={(event) => {
                  pick(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </Button>
        </div>
      </div>

      {selection ? (
        <div className="upload-queue">
          <header>
            <p>
              {started ? (
                <UploadSummary summary={upload.summary} />
              ) : (
                `已选择 ${selection.files.length} 个 .map 文件`
              )}
              {selection.ignored ? `，忽略 ${selection.ignored} 个非 .map 文件` : ""}
            </p>
            <div>
              {!started ? (
                <Button
                  type="button"
                  disabled={disabled || !selection.files.length}
                  onClick={() => void upload.start(selection.files, prefix)}
                >
                  <UploadCloudIcon />
                  上传 {selection.files.length} 个文件
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={upload.busy}
                onClick={() => {
                  upload.clear();
                  setSelection(undefined);
                }}
              >
                <XIcon />
                {started ? "清空结果" : "取消"}
              </Button>
            </div>
          </header>
          <ol aria-label="上传队列">
            {started
              ? upload.items.map((item) => (
                  <UploadRow
                    key={item.id}
                    item={item}
                    onReplace={() => void upload.replace(item)}
                    replaceDisabled={Boolean(disabledReason)}
                  />
                ))
              : selection.files.map((file) => (
                  <li key={file.relativePath}>
                    <div className="upload-queue__name">
                      <code>{artifactNameFor(file.relativePath, prefix)}</code>
                      <small>{formatBytes(file.file.size)}</small>
                    </div>
                    <Badge variant="outline">待上传</Badge>
                  </li>
                ))}
          </ol>
          {started && !upload.busy && (upload.summary.ready || upload.summary.skipped) ? (
            <p className="upload-queue__note">
              {`已上传。近 ${remapWindowDays} 天内版本 ${release.version}${
                release.dist ? `（dist ${release.dist}）` : " "
              }未能还原的错误会自动重新还原。`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function UploadSummary({ summary }: { summary: ReturnType<typeof summarizeUploads> }) {
  return (
    <span role="status">
      {summary.active ? `正在处理 ${summary.active} 个文件 · ` : "上传结束 · "}可用 {summary.ready}
      ，跳过 {summary.skipped}，失败 {summary.failed}
    </span>
  );
}

function UploadRow({
  item,
  onReplace,
  replaceDisabled,
}: {
  item: UploadItem;
  onReplace: () => void;
  replaceDisabled: boolean;
}) {
  const percent = Math.round(item.progress * 100);
  return (
    <li data-status={item.status}>
      <div className="upload-queue__name">
        <code>{item.artifactName}</code>
        <small>{formatBytes(item.file.size)}</small>
        {item.status === "uploading" ? (
          <Progress value={percent} aria-label={`${item.artifactName} 上传进度`} />
        ) : null}
        {item.error ? <p className="upload-queue__error">{item.error.message}</p> : null}
      </div>
      <div className="upload-queue__state">
        <Badge
          variant={
            item.status === "ready"
              ? "success"
              : item.status === "failed"
                ? "destructive"
                : item.status === "skipped"
                  ? "secondary"
                  : "outline"
          }
        >
          {statusLabels[item.status]}
          {item.status === "uploading" ? ` ${percent}%` : ""}
        </Badge>
        {item.error?.canReplace ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={replaceDisabled}
            onClick={onReplace}
          >
            <RefreshCwIcon />
            替换
          </Button>
        ) : null}
      </div>
    </li>
  );
}
