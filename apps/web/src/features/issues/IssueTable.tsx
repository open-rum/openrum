import { ArrowDownIcon, UserRoundIcon } from "lucide-react";
import { MemberLabel } from "@/components/account/MemberLabel";
import { UserAvatar } from "@/components/account/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
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
import type { OrganizationMember } from "@/lib/api/projects";
import { IssueStatusLabel } from "./IssueStatusLabel";
import { issueSorts } from "./issueSort";
import { withTimePreset } from "./issueTime";
import { issueStatusLabel } from "./issueStatus";
import { formatAbsoluteTime, formatRelativeTime, isNewInRange } from "./issueTime";

type IssueSort = IssueFilters["sort"];

type Issue = IssuesResponse["issues"][number];

/** Who can own an Issue, and how to change it; leave `onAssign` out for read-only people. */
export type IssueAssignment = {
  members?: OrganizationMember[];
  onAssign?: (issue: Issue, assigneeUserId: string) => void;
};

export type IssueSelection = {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
};

export function IssueTable({
  issues,
  filters,
  onSortChange,
  selection,
  assignment,
}: {
  issues: IssuesResponse["issues"];
  filters: IssueFilters;
  onSortChange?: (sort: IssueSort) => void;
  /** Leave out for people who cannot change Issues; the checkbox column then disappears. */
  selection?: IssueSelection;
  assignment?: IssueAssignment;
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
          title={`按${label}排序：${issueSorts.find((item) => item.value === sort)?.hint ?? ""}`}
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
          {sortableHead("trend", "趋势", "issue-col-trend")}
          {sortableHead("events", "事件", "issue-col-number")}
          {sortableHead("users", "用户", "issue-col-number")}
          {sortableHead("last_seen", "最近发生", "issue-col-time")}
          {sortableHead("first_seen", "首次发生", "issue-col-time")}
          <TableHead className="issue-col-assignee">负责人</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((issue, index) => {
          const parameters = withTimePreset(serializeIssueFilters(filters));
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
              <TableCell className="issue-col-time">
                <time dateTime={issue.firstSeenAt} title={formatAbsoluteTime(issue.firstSeenAt)}>
                  {formatRelativeTime(issue.firstSeenAt)}
                </time>
              </TableCell>
              {/* The picker's menu is portalled, but React still bubbles its events through here. */}
              <TableCell
                className="issue-col-assignee"
                onClick={(event) => event.stopPropagation()}
              >
                <AssigneeCell issue={issue} assignment={assignment} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * The owner's picture, or an empty outline when nobody owns the Issue. People who can change
 * Issues pick another owner right here; the row click ignores the picker.
 */
function AssigneeCell({ issue, assignment }: { issue: Issue; assignment?: IssueAssignment }) {
  const owner = issue.assigneeUserId
    ? assignment?.members?.find((member) => member.userId === issue.assigneeUserId)
    : undefined;
  const ownerName = owner ? owner.displayName || owner.email : issue.assigneeUserId ? "成员" : "";
  const face = issue.assigneeUserId ? (
    <UserAvatar userId={issue.assigneeUserId} name={ownerName} avatar={owner?.avatar} size="sm" />
  ) : (
    <span className="issue-assignee-empty">
      <UserRoundIcon aria-hidden="true" />
    </span>
  );
  const label = issue.assigneeUserId ? `负责人：${ownerName}` : "未分配";
  if (!assignment?.onAssign) {
    return (
      <span className="issue-assignee" title={label} aria-label={label}>
        {face}
      </span>
    );
  }
  const onAssign = assignment.onAssign;
  return (
    <Select
      value={issue.assigneeUserId ?? "none"}
      onValueChange={(value) => onAssign(issue, value === "none" ? "" : value)}
    >
      <SelectTrigger
        size="sm"
        className="issue-assignee-trigger"
        aria-label={`${label}，更换负责人`}
        title={label}
      >
        {face}
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          <SelectItem value="none">未分配</SelectItem>
          {assignment.members?.map((member) => (
            <SelectItem key={member.userId} value={member.userId}>
              <MemberLabel member={member} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
