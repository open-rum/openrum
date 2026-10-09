import { ArrowDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sparkline } from "@/lib/charts/Sparkline";
import { serializeIssueFilters, type IssueFilters, type IssuesResponse } from "@/lib/api/issues";
import { IssueStatusLabel } from "./IssueStatusLabel";
import { issueStatusLabel } from "./issueStatus";
import { formatAbsoluteTime, formatRelativeTime, isNewInRange } from "./issueTime";

type IssueSort = IssueFilters["sort"];

export type IssueSelection = {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
};

export function IssueTable({
  issues,
  filters,
  onSortChange,
  selection,
}: {
  issues: IssuesResponse["issues"];
  filters: IssueFilters;
  onSortChange?: (sort: IssueSort) => void;
  /** Leave out for people who cannot change Issues; the checkbox column then disappears. */
  selection?: IssueSelection;
}) {
  const selectedCount = selection
    ? issues.filter((issue) => selection.selected.has(issue.fingerprint)).length
    : 0;
  const toggle = (fingerprint: string, on: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (on) next.add(fingerprint);
    else next.delete(fingerprint);
    selection.onChange(next);
  };
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
  const sortableHead = (sort: IssueSort, label: string, className?: string) => (
    <TableHead className={className} aria-sort={filters.sort === sort ? "descending" : undefined}>
      {onSortChange ? (
        <button
          type="button"
          className="issue-sort-button"
          data-active={filters.sort === sort || undefined}
          onClick={() => onSortChange(sort)}
          title={`按${label}从高到低排序`}
        >
          {label}
          <ArrowDownIcon aria-hidden="true" />
        </button>
      ) : (
        label
      )}
    </TableHead>
  );
  return (
    <Table className="issues-list-table">
      <TableHeader>
        <TableRow>
          {selection ? (
            <TableHead className="issue-col-select">
              <Checkbox
                aria-label="选择本页全部问题"
                checked={
                  selectedCount === 0
                    ? false
                    : selectedCount === issues.length
                      ? true
                      : "indeterminate"
                }
                onCheckedChange={(checked) =>
                  selection.onChange(
                    checked === true
                      ? new Set(issues.map((issue) => issue.fingerprint))
                      : new Set(),
                  )
                }
              />
            </TableHead>
          ) : null}
          <TableHead>问题</TableHead>
          <TableHead className="issue-col-trend">趋势</TableHead>
          {sortableHead("events", "事件", "issue-col-number")}
          {sortableHead("users", "用户", "issue-col-number")}
          {sortableHead("last_seen", "最近发生", "issue-col-time")}
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((issue, index) => {
          const parameters = serializeIssueFilters(filters);
          const href = `/projects/${encodeURIComponent(filters.projectId)}/issues/${encodeURIComponent(issue.fingerprint)}?${parameters.toString()}`;
          const isNew = isNewInRange(issue.firstSeenAt, filters.from);
          const location = [issue.culprit?.function, issue.culprit?.file]
            .filter(Boolean)
            .join(" · ");
          return (
            <TableRow
              key={issue.fingerprint}
              data-issue-row
              data-selected={selection?.selected.has(issue.fingerprint) || undefined}
              tabIndex={index === 0 ? 0 : -1}
              aria-label={`${issueStatusLabel[issue.status]}：${issue.title}`}
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
              {selection ? (
                <TableCell
                  className="issue-col-select"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    aria-label={`选择问题：${issue.title}`}
                    checked={selection.selected.has(issue.fingerprint)}
                    onCheckedChange={(checked) => toggle(issue.fingerprint, checked === true)}
                  />
                </TableCell>
              ) : null}
              <TableCell>
                <div className="issue-list-heading-line">
                  <a className="issue-list-title" href={href} title={issue.title}>
                    {issue.title}
                  </a>
                  {isNew ? (
                    <Badge
                      variant="warning"
                      title={`首次发生在 ${formatAbsoluteTime(issue.firstSeenAt)}，在当前时间范围内`}
                    >
                      新
                    </Badge>
                  ) : null}
                </div>
                <div className="issue-list-meta">
                  {/* Unresolved is the normal state; only the others deserve a mark. */}
                  {issue.status === "unresolved" ? null : (
                    <IssueStatusLabel status={issue.status} />
                  )}
                  <code title={location ? `${issue.errorType} · ${location}` : issue.fingerprint}>
                    {[issue.errorType, location].filter(Boolean).join(" · ")}
                  </code>
                </div>
              </TableCell>
              <TableCell className="issue-col-trend">
                <Sparkline
                  values={issue.trend ?? []}
                  color={
                    issue.status === "unresolved" || issue.status === "regressed"
                      ? "var(--ds-chart-1)"
                      : "var(--ds-text-muted)"
                  }
                  className="h-8 w-[88px]"
                />
              </TableCell>
              <TableCell className="issue-col-number font-medium tabular-nums">
                {issue.events.toLocaleString()}
              </TableCell>
              <TableCell className="issue-col-number tabular-nums">
                {issue.users.toLocaleString()}
              </TableCell>
              <TableCell className="issue-col-time">
                <time dateTime={issue.lastSeenAt} title={formatAbsoluteTime(issue.lastSeenAt)}>
                  {formatRelativeTime(issue.lastSeenAt)}
                </time>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
