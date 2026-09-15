import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  serializeIssueFilters,
  type IssueFilters,
  type IssuesResponse,
  type IssueStatus,
} from "@/lib/api/issues";

const statusLabel: Record<IssueStatus, string> = {
  unresolved: "待处理",
  resolved: "已解决",
  ignored: "已忽略",
};

export function IssueTable({
  issues,
  filters,
}: {
  issues: IssuesResponse["issues"];
  filters: IssueFilters;
}) {
  const maximumEvents = Math.max(1, ...issues.map((issue) => issue.events));
  function handleRowKey(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    index: number,
    href: string,
  ) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") window.location.assign(href);
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("[data-issue-row]"));
    rows[
      Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
    ]?.focus();
  }
  return (
    <Table className="issues-list-table">
      <TableHeader>
        <TableRow>
          <TableHead>状态</TableHead>
          <TableHead>问题</TableHead>
          <TableHead>事件</TableHead>
          <TableHead>用户</TableHead>
          <TableHead>会话</TableHead>
          <TableHead>首次发生</TableHead>
          <TableHead>最近发生</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((issue, index) => {
          const parameters = serializeIssueFilters(filters);
          const href = `/projects/${encodeURIComponent(filters.projectId)}/issues/${encodeURIComponent(issue.fingerprint)}?${parameters.toString()}`;
          return (
            <TableRow
              key={issue.fingerprint}
              data-issue-row
              tabIndex={index === 0 ? 0 : -1}
              aria-label={`${statusLabel[issue.status]}：${issue.title}`}
              className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={(event) => {
                if (
                  (event.target as HTMLElement).closest("a, button") ||
                  window.getSelection()?.toString()
                )
                  return;
                if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
                else window.location.assign(href);
              }}
              onKeyDown={(event) => handleRowKey(event, index, href)}
            >
              <TableCell>
                <StatusBadge status={issue.status} />
              </TableCell>
              <TableCell>
                <a className="issue-list-title" href={href} title={issue.title}>
                  {issue.title}
                </a>
                <code
                  className="mt-1 block truncate text-xs text-muted-foreground"
                  title={issue.fingerprint}
                >
                  {issue.errorType} · {issue.fingerprint}
                </code>
              </TableCell>
              <TableCell className="font-medium tabular-nums">
                {issue.events.toLocaleString()}
                <div className="issue-event-meter" aria-hidden="true">
                  <i style={{ width: `${(issue.events / maximumEvents) * 100}%` }} />
                </div>
              </TableCell>
              <TableCell className="tabular-nums">{issue.users.toLocaleString()}</TableCell>
              <TableCell className="tabular-nums">{issue.sessions.toLocaleString()}</TableCell>
              <TableCell>
                <time
                  dateTime={issue.firstSeenAt}
                  title={new Date(issue.firstSeenAt).toLocaleString("zh-CN")}
                >
                  {formatTime(issue.firstSeenAt)}
                </time>
              </TableCell>
              <TableCell>
                <time
                  dateTime={issue.lastSeenAt}
                  title={new Date(issue.lastSeenAt).toLocaleString("zh-CN")}
                >
                  {formatTime(issue.lastSeenAt)}
                </time>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function StatusBadge({ status }: { status: IssueStatus }) {
  return (
    <Badge
      variant={
        status === "unresolved" ? "destructive" : status === "resolved" ? "secondary" : "outline"
      }
    >
      {statusLabel[status]}
    </Badge>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
