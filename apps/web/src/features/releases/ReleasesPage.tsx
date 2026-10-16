import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { FileArchiveIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { ConsolePage } from "@/components/layout/ConsolePage";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { sessionQueryOptions } from "@/lib/auth/session";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { createRelease, getSourceMapStatus, listReleases, type Release } from "@/lib/api/releases";
import { CreateReleaseCard, type ReleaseInput } from "./CreateReleaseCard";
import { MatchTester } from "./MatchTester";
import { ReleaseArtifactsCard } from "./ReleaseArtifactsCard";
import { ReleaseList } from "./ReleaseList";
import { readReleasePreselection } from "./releaseLinks";
import { AccessDetails, SetupGuide } from "./SetupGuide";
import { StorageStatusBanner } from "./StorageStatusBanner";

export function SourceMapPage() {
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
          <EmptyDescription>先创建项目再管理 Source Map。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <ProjectReleases key={project.id} project={project} />;
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function releaseLabel(release: { version: string; dist: string }) {
  return release.dist ? `${release.version}（dist ${release.dist}）` : release.version;
}

function ProjectReleases({ project }: { project: Project }) {
  const client = useQueryClient();
  const session = useQuery(sessionQueryOptions());
  const status = useQuery({
    queryKey: ["sourcemap-status", project.id],
    queryFn: ({ signal }) => getSourceMapStatus(project.id, signal),
    retry: false,
  });
  // `?release=<version>&dist=<dist>` (from an Issue's stack guidance) preselects that release,
  // or prefills the registration form when it does not exist yet.
  const [preselect, setPreselect] = useState(() => readReleasePreselection(window.location.search));
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim(), 300);
  const releases = useInfiniteQuery({
    queryKey: ["releases", project.id, "list", query],
    queryFn: ({ pageParam, signal }) =>
      listReleases(project.id, { q: query || undefined, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const lookup = useQuery({
    queryKey: ["releases", project.id, "lookup", preselect?.version, preselect?.dist],
    queryFn: ({ signal }) =>
      listReleases(project.id, { q: preselect!.version, limit: 100 }, signal),
    enabled: Boolean(preselect),
  });
  const [chosen, setChosen] = useState<Release>();
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Registering by hand is the rare path (the build plugin registers on upload), so the form
  // stays closed until asked for. Until then it follows the URL: a link that names a release
  // that does not exist yet opens it prefilled. Undefined means "not decided by the person".
  const [registerOpen, setRegisterOpen] = useState<boolean>();

  const loaded = (releases.data?.pages.flatMap((page) => page.releases) ?? []).filter(
    (release) => !deletedIds.has(release.id),
  );
  const lookupReleases = (lookup.data?.releases ?? []).filter(
    (release) => !deletedIds.has(release.id),
  );
  const preselected = preselect
    ? lookupReleases.find(
        (release) => release.version === preselect.version && release.dist === preselect.dist,
      )
    : undefined;
  const missingPreselect = Boolean(preselect && lookup.isSuccess && !preselected);
  const registering = registerOpen ?? missingPreselect;
  // Re-read the chosen release from fresh query data so counts update after uploads.
  const fresh = (release?: Release) =>
    release &&
    (loaded.find((item) => item.id === release.id) ??
      lookupReleases.find((item) => item.id === release.id) ??
      release);
  // A preselection that is still loading or missing shows no release rather than the newest one.
  const current = fresh(chosen) ?? preselected ?? (preselect ? undefined : loaded[0]);

  const create = useMutation({
    mutationFn: (input: ReleaseInput) => createRelease(project.id, input),
    onSuccess: ({ release, created }) => {
      setChosen(release);
      setPreselect(undefined);
      setRegisterOpen(false);
      toast.success(
        created
          ? `已登记版本 ${releaseLabel(release)}，现在可以上传 Source Map。`
          : `版本 ${releaseLabel(release)} 已存在，已为你选中。`,
      );
      void client.invalidateQueries({ queryKey: ["releases", project.id] });
    },
  });

  // A Project with no release at all is new to this: show the setup as the page, not a list
  // with nothing in it. A search that matches nothing is not that case.
  const noReleases = releases.isSuccess && !query && loaded.length === 0;

  return (
    <SettingsShell
      title="Source Map"
      description="将压缩代码还原到源码；Source Map 只保存在私有对象存储中，不进入公开构建。"
      width="wide"
      actions={
        <Button
          type="button"
          variant="outline"
          aria-expanded={registering}
          onClick={() => setRegisterOpen(!registering)}
        >
          <PlusIcon />
          登记版本
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <StorageStatusBanner
          storage={status.data?.storage}
          instanceAdmin={Boolean(session.data?.instanceRole)}
        />
        {releases.error ? (
          <AsyncError
            error={releases.error}
            title="版本加载失败"
            remediation="确认当前角色具有项目访问权限后重新加载。"
            onRetry={() => void releases.refetch()}
          />
        ) : null}
        {registering ? (
          <CreateReleaseCard
            key={missingPreselect ? `prefill:${preselect?.version}:${preselect?.dist}` : "blank"}
            initialVersion={missingPreselect ? preselect?.version : undefined}
            initialDist={missingPreselect ? preselect?.dist : undefined}
            hint={
              missingPreselect && preselect
                ? `版本 ${releaseLabel(preselect)}${preselect.dist ? "" : " "}尚未登记。确认信息后登记，再上传它的 Source Map。`
                : undefined
            }
            pending={create.isPending}
            error={create.error ? `登记失败：${create.error.message}` : undefined}
            onCreate={(input) => create.mutateAsync(input)}
            onCancel={() => setRegisterOpen(false)}
          />
        ) : null}
        {noReleases ? (
          <SetupGuide projectId={project.id} />
        ) : (
          <>
            <div className="releases-layout">
              <ReleaseList
                releases={loaded}
                selectedId={current?.id}
                onSelect={(release) => {
                  setChosen(release);
                }}
                search={search}
                onSearchChange={setSearch}
                loading={releases.isLoading}
                hasMore={Boolean(releases.hasNextPage)}
                loadingMore={releases.isFetchingNextPage}
                onLoadMore={() => void releases.fetchNextPage()}
              />
              <div className="releases-detail">
                {current ? (
                  <ReleaseArtifactsCard
                    key={current.id}
                    projectId={project.id}
                    release={current}
                    status={status.data}
                    instanceAdmin={Boolean(session.data?.instanceRole)}
                    onDeleted={(release) => {
                      setDeletedIds((ids) => new Set(ids).add(release.id));
                      setChosen(undefined);
                      setPreselect(undefined);
                    }}
                  />
                ) : (
                  <p className="release-empty-copy">
                    选择左侧的一个版本，查看和管理它的 Source Map。
                  </p>
                )}
                <MatchTester projectId={project.id} release={current} />
              </div>
            </div>
            <AccessDetails projectId={project.id} />
          </>
        )}
      </div>
    </SettingsShell>
  );
}

function ReleasesSkeleton() {
  return (
    <ConsolePage width="wide" aria-label="正在加载版本">
      <Skeleton className="h-28" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </ConsolePage>
  );
}
