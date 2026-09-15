import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  FileArchiveIcon,
  FlaskConicalIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadCloudIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
  createRelease,
  deleteArtifact,
  listArtifacts,
  listReleases,
  testSourceMap,
  uploadArtifact,
  type Release,
} from "@/lib/api/releases";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { ProjectSettingsNav } from "@/features/settings/ProjectSettingsNav";

export function ReleasesPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (organizations.isLoading || projects.isLoading) return <ReleasesSkeleton />;
  if (!project)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileArchiveIcon />
          </EmptyMedia>
          <EmptyTitle>还没有项目</EmptyTitle>
          <EmptyDescription>先创建项目再管理 Release。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <ProjectReleases project={project} />;
}

function ProjectReleases({ project }: { project: Project }) {
  const client = useQueryClient();
  const releases = useQuery({
    queryKey: ["releases", project.id],
    queryFn: ({ signal }) => listReleases(project.id, signal),
  });
  const [selectedId, setSelectedId] = useState<string>();
  const selected =
    releases.data?.releases.find((release) => release.id === selectedId) ??
    releases.data?.releases[0];
  const create = useMutation({
    mutationFn: (input: { version: string; dist: string; commitSha: string }) =>
      createRelease(project.id, input),
    onSuccess: (release) => {
      void client.invalidateQueries({ queryKey: ["releases", project.id] });
      setSelectedId(release.id);
    },
  });
  return (
    <ConsolePage
      width="wide"
      rail={<ProjectSettingsNav projectId={project.id} />}
      railLabel="项目设置导航"
    >
      <ConsolePageHeader
        title="Release 与 Source Map"
        description="将压缩代码安全还原到源码；Source Map 只上传到私有 OSS，不进入公开构建。"
      />
      {releases.error ? (
        <AsyncError
          error={releases.error}
          title="Release 加载失败"
          remediation="确认当前角色具有 Release 管理权限后重新加载。"
          onRetry={() => void releases.refetch()}
        />
      ) : null}
      <div className="releases-layout">
        <div className="releases-main">
          <CreateReleaseCard
            pending={create.isPending}
            error={Boolean(create.error)}
            onCreate={(input) => create.mutate(input)}
          />
          {releases.isLoading ? <Skeleton className="h-72" /> : null}
          {releases.data?.releases.length ? (
            <ReleaseList
              releases={releases.data.releases}
              selectedId={selected?.id}
              onSelect={setSelectedId}
            />
          ) : null}
          {releases.data && !releases.data.releases.length ? <ReleaseEmpty /> : null}
          {selected ? <ArtifactsCard projectId={project.id} release={selected} /> : null}
        </div>
        <aside className="releases-side">
          <QuickStart project={project} />
          <MatchTester projectId={project.id} release={selected} />
        </aside>
      </div>
    </ConsolePage>
  );
}

function CreateReleaseCard({
  pending,
  error,
  onCreate,
}: {
  pending: boolean;
  error: boolean;
  onCreate: (input: { version: string; dist: string; commitSha: string }) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>登记新 Release</CardTitle>
        <CardDescription>SDK 上报的 release 与 dist 必须完全一致。</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="release-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onCreate({
              version: String(data.get("version") ?? "").trim(),
              dist: String(data.get("dist") ?? "").trim(),
              commitSha: String(data.get("commitSha") ?? "").trim(),
            });
            event.currentTarget.reset();
          }}
        >
          <label>
            <span>Release *</span>
            <input required name="version" maxLength={128} placeholder="web@2026.09.03" />
          </label>
          <label>
            <span>Dist</span>
            <input name="dist" maxLength={64} placeholder="browser" />
          </label>
          <label>
            <span>Commit SHA</span>
            <input name="commitSha" maxLength={64} placeholder="a1b2c3d" />
          </label>
          <Button type="submit" disabled={pending}>
            <PlusIcon />
            {pending ? "创建中…" : "创建"}
          </Button>
        </form>
        {error ? <p className="release-form__error">创建失败，版本可能已存在。</p> : null}
      </CardContent>
    </Card>
  );
}

function ReleaseList({
  releases,
  selectedId,
  onSelect,
}: {
  releases: Release[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>最近 Releases</CardTitle>
        <CardDescription>选择一个版本查看并管理 Artifact。</CardDescription>
      </CardHeader>
      <CardContent className="release-list">
        {releases.map((release) => (
          <button
            type="button"
            key={release.id}
            className={release.id === selectedId ? "is-active" : undefined}
            onClick={() => onSelect(release.id)}
          >
            <span>
              <strong>{release.version}</strong>
              <small>{release.dist || "默认 dist"}</small>
            </span>
            <code>{release.commitSha || "—"}</code>
            <time dateTime={release.createdAt}>
              {new Date(release.createdAt).toLocaleString("zh-CN")}
            </time>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function ArtifactsCard({ projectId, release }: { projectId: string; release: Release }) {
  const client = useQueryClient();
  const artifacts = useQuery({
    queryKey: ["artifacts", projectId, release.id],
    queryFn: ({ signal }) => listArtifacts(projectId, release.id, signal),
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadArtifact(projectId, release.id, file),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["artifacts", projectId, release.id] }),
  });
  const remove = useMutation({
    mutationFn: (artifactId: string) => deleteArtifact(projectId, release.id, artifactId),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["artifacts", projectId, release.id] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source Map Artifacts</CardTitle>
        <CardDescription>
          {release.version} · {release.dist || "默认 dist"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="artifact-drop">
          <UploadCloudIcon />
          <span>
            <strong>{upload.isPending ? "正在校验并上传…" : "选择 .map 文件"}</strong>
            <small>浏览器计算 SHA-256，直传 OSS 后由服务端复核。</small>
          </span>
          <input
            type="file"
            accept=".map,application/json"
            disabled={upload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {upload.error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>上传未完成</AlertTitle>
            <AlertDescription>Artifact 已安全标记，公开产物不会受影响。</AlertDescription>
          </Alert>
        ) : null}
        {artifacts.isLoading ? <Skeleton className="mt-4 h-40" /> : null}
        {artifacts.data?.artifacts.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {artifacts.data.artifacts.map((artifact) => (
                <TableRow key={artifact.id}>
                  <TableCell>
                    <code>{artifact.artifactName}</code>
                  </TableCell>
                  <TableCell>{formatBytes(artifact.sizeBytes)}</TableCell>
                  <TableCell>
                    <ArtifactStatus status={artifact.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`删除 ${artifact.artifactName}`}
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`删除 ${artifact.artifactName}？原始堆栈仍会保留。`))
                          remove.mutate(artifact.id);
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {artifacts.data && !artifacts.data.artifacts.length ? (
          <p className="release-empty-copy">这个 Release 还没有 Source Map。</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QuickStart({ project }: { project: Project }) {
  const snippet = `openRUMSourceMaps({\n  baseUrl: "${window.location.origin}",\n  projectId: "${project.id}",\n  release: process.env.OPENRUM_RELEASE,\n  sessionCookie: process.env.OPENRUM_SESSION,\n  csrfToken: process.env.OPENRUM_CSRF_TOKEN,\n})`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vite 快速接入</CardTitle>
        <CardDescription>
          插件在构建结束时读取后立即删除公开目录中的 .map，再执行私有上传。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="release-code">
          <code>{snippet}</code>
        </pre>
        <p className="release-security">
          <CheckCircle2Icon />
          构建失败时也不会留下公开 Source Map
        </p>
      </CardContent>
    </Card>
  );
}

function MatchTester({ projectId, release }: { projectId: string; release?: Release }) {
  const [url, setURL] = useState("https://example.com/assets/app.js");
  const [line, setLine] = useState("1");
  const [column, setColumn] = useState("0");
  const match = useMutation({
    mutationFn: () =>
      testSourceMap(projectId, {
        release: release?.version ?? "",
        dist: release?.dist ?? "",
        stack: `at OpenRUMTest (${url}:${line}:${column})`,
      }),
  });
  const frame = match.data?.frames.find((item) => item.original)?.original;
  return (
    <Card>
      <CardHeader>
        <CardTitle>匹配测试器</CardTitle>
        <CardDescription>输入生产脚本位置，确认是否能还原到预期源码。</CardDescription>
      </CardHeader>
      <CardContent className="match-tester">
        <label>
          <span>脚本 URL</span>
          <input value={url} onChange={(event) => setURL(event.target.value)} />
        </label>
        <div>
          <label>
            <span>行</span>
            <input
              inputMode="numeric"
              value={line}
              onChange={(event) => setLine(event.target.value)}
            />
          </label>
          <label>
            <span>列</span>
            <input
              inputMode="numeric"
              value={column}
              onChange={(event) => setColumn(event.target.value)}
            />
          </label>
        </div>
        <Button
          variant="outline"
          disabled={!release || match.isPending}
          onClick={() => match.mutate()}
        >
          <FlaskConicalIcon />
          {match.isPending ? "测试中…" : "测试匹配"}
        </Button>
        {match.data ? (
          <div className={`match-result is-${match.data.status}`}>
            <ArtifactStatus status={match.data.status === "mapped" ? "ready" : "failed"} />
            <strong>
              {frame
                ? `${frame.source}:${frame.line}:${frame.column}`
                : match.data.failure || "没有匹配位置"}
            </strong>
          </div>
        ) : null}
        {match.error ? (
          <p className="release-form__error">测试失败，请检查存储或服务状态。</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ArtifactStatus({ status }: { status: "pending" | "ready" | "failed" }) {
  return (
    <Badge
      variant={status === "ready" ? "secondary" : status === "failed" ? "destructive" : "outline"}
    >
      {status === "ready" ? "可用" : status === "failed" ? "失败" : "校验中"}
    </Badge>
  );
}
function ReleaseEmpty() {
  return (
    <Empty className="border border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileArchiveIcon />
        </EmptyMedia>
        <EmptyTitle>还没有 Release</EmptyTitle>
        <EmptyDescription>
          先登记与 SDK 一致的 release，再上传构建产生的隐藏 Source Map。
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
function ReleasesSkeleton() {
  return (
    <ConsolePage width="wide" aria-label="正在加载 Releases">
      <Skeleton className="h-28" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </ConsolePage>
  );
}
function formatBytes(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
