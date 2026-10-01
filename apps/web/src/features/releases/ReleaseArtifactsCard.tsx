import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteArtifact,
  deleteRelease,
  listArtifacts,
  type Release,
  type SourceMapStatus,
} from "@/lib/api/releases";
import { ArtifactStatus } from "./ArtifactStatus";
import { ArtifactUploader } from "./ArtifactUploader";
import { formatBytes } from "./format";
import { ReleaseCountBadge } from "./ReleaseList";

export function ReleaseArtifactsCard({
  projectId,
  release,
  status,
  onDeleted,
}: {
  projectId: string;
  release: Release;
  status?: SourceMapStatus;
  onDeleted: (release: Release) => void;
}) {
  const client = useQueryClient();
  const artifactsKey = ["artifacts", projectId, release.id];
  const artifacts = useQuery({
    queryKey: artifactsKey,
    queryFn: ({ signal }) => listArtifacts(projectId, release.id, signal),
  });
  const removeArtifact = useMutation({
    mutationFn: (artifactId: string) => deleteArtifact(projectId, release.id, artifactId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: artifactsKey });
      void client.invalidateQueries({ queryKey: ["releases", projectId] });
    },
  });
  const removeRelease = useMutation({
    mutationFn: () => deleteRelease(projectId, release.id),
    onSuccess: () => {
      toast.success(`已删除版本 ${release.version} 及其 Source Map`);
      client.removeQueries({ queryKey: artifactsKey });
      void client.invalidateQueries({ queryKey: ["releases", projectId] });
      onDeleted(release);
    },
  });
  const storage = status?.storage;
  const disabledReason =
    storage === "not_configured"
      ? "实例尚未配置对象存储，暂时无法上传。"
      : storage === "unavailable"
        ? "对象存储暂不可用，恢复后再上传。"
        : undefined;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>
            {release.version}
            <span className="release-detail__dist">
              {release.dist ? `dist ${release.dist}` : "默认 dist"}
            </span>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <ReleaseCountBadge release={release} />
            {release.commitSha ? <code>{release.commitSha}</code> : null}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ArtifactUploader
          key={release.id}
          projectId={projectId}
          release={release}
          disabledReason={disabledReason}
          maxBytes={status?.maxArtifactBytes}
          remapWindowDays={status?.remapWindowDays ?? 7}
        />

        {artifacts.isLoading ? <Skeleton className="h-40" /> : null}
        {artifacts.error ? (
          <p className="release-form__error" role="alert">
            Source Map 列表加载失败：{artifacts.error.message}
          </p>
        ) : null}
        {artifacts.data?.artifacts.length ? (
          <Table aria-label="已上传的 Source Map">
            <TableHeader>
              <TableRow>
                <TableHead>匹配名</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {artifacts.data.artifacts.map((artifact) => (
                <TableRow key={artifact.id}>
                  <TableCell className="max-w-md">
                    <code className="block truncate" title={artifact.artifactName}>
                      {artifact.artifactName}
                    </code>
                    {artifact.status === "failed" && artifact.errorMessage ? (
                      <p className="upload-queue__error">{artifact.errorMessage}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatBytes(artifact.sizeBytes)}</TableCell>
                  <TableCell>
                    <ArtifactStatus status={artifact.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <HoldButton
                      size="sm"
                      icon={<Trash2Icon />}
                      doneLabel="已删除"
                      disabled={removeArtifact.isPending}
                      aria-label={`长按删除 ${artifact.artifactName}`}
                      onHold={() => removeArtifact.mutate(artifact.id)}
                    >
                      长按删除
                    </HoldButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {artifacts.data && !artifacts.data.artifacts.length ? (
          <p className="release-empty-copy">这个版本还没有 Source Map。</p>
        ) : null}
        {removeArtifact.error ? (
          <p className="release-form__error" role="alert">
            {removeArtifact.error.message}
          </p>
        ) : null}

        <div className="release-danger">
          <div>
            <strong>删除版本</strong>
            <p>删除版本记录和全部 Source Map 文件；已上报的原始堆栈会保留。</p>
            {removeRelease.error ? (
              <p className="release-form__error" role="alert">
                {removeRelease.error.message}
              </p>
            ) : null}
          </div>
          <HoldButton
            icon={<Trash2Icon />}
            doneIcon={<Trash2Icon />}
            doneLabel={removeRelease.isPending ? "正在删除…" : "已删除"}
            disabled={removeRelease.isPending}
            aria-label={`长按删除版本 ${release.version}`}
            onHold={() => removeRelease.mutate()}
          >
            长按删除版本
          </HoldButton>
        </div>
      </CardContent>
    </Card>
  );
}
