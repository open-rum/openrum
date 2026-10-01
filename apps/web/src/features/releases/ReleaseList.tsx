import { SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Release } from "@/lib/api/releases";
import { formatDateTime } from "./format";

export function ReleaseCountBadge({ release }: { release: Release }) {
  if (!release.artifactCount) return <Badge variant="outline">无 Source Map</Badge>;
  const complete = release.readyCount === release.artifactCount;
  return (
    <Badge
      variant={complete ? "success" : "outline"}
      aria-label={`${release.readyCount} 个可用，共 ${release.artifactCount} 个文件`}
    >
      {release.readyCount}/{release.artifactCount} 可用
    </Badge>
  );
}

export function ReleaseList({
  releases,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  releases: Release[];
  selectedId?: string;
  onSelect: (release: Release) => void;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>版本</CardTitle>
        <CardDescription>选择一个版本查看、上传或删除它的 Source Map。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="release-search">
          <SearchIcon aria-hidden="true" />
          <Input
            type="search"
            aria-label="搜索版本"
            placeholder="按版本号搜索"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        {loading ? <Skeleton className="h-48" /> : null}
        {!loading && !releases.length ? (
          <p className="release-empty-copy">
            {search.trim()
              ? `没有包含“${search.trim()}”的版本。`
              : "还没有登记任何版本。先登记与 SDK 一致的 release，再上传构建产生的隐藏 Source Map。"}
          </p>
        ) : null}
        {releases.length ? (
          <div className="release-list" aria-label="版本列表">
            {releases.map((release) => (
              <button
                type="button"
                key={release.id}
                aria-current={release.id === selectedId ? "true" : undefined}
                className={release.id === selectedId ? "is-active" : undefined}
                onClick={() => onSelect(release)}
              >
                <span>
                  <strong>{release.version}</strong>
                  <small>{release.dist ? `dist ${release.dist}` : "默认 dist"}</small>
                </span>
                <ReleaseCountBadge release={release} />
                <code>{release.commitSha ? release.commitSha.slice(0, 12) : "—"}</code>
                <time dateTime={release.deployedAt ?? release.createdAt}>
                  {release.deployedAt ? "部署于 " : "登记于 "}
                  {formatDateTime(release.deployedAt ?? release.createdAt)}
                </time>
              </button>
            ))}
          </div>
        ) : null}
        {hasMore ? (
          <Button
            type="button"
            variant="outline"
            className="justify-self-center"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "加载中…" : "加载更多"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
