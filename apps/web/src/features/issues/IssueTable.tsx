import { ArrowDownIcon, UserRoundIcon } from "lucide-react";
import { MemberLabel } from "@/components/account/MemberLabel";
import { UserAvatar } from "@/components/account/UserAvatar";
import { DaisyDropdown } from "@/components/daisy/DaisyDropdown";
import { cn } from "@/lib/utils";
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
  onOpen,
}: {
  issues: IssuesResponse["issues"];
  filters: IssueFilters;
  onSortChange?: (sort: IssueSort) => void;
  /** Leave out for people who cannot change Issues; the checkbox column then disappears. */
  selection?: IssueSelection;
  assignment?: IssueAssignment;
  /** Opens an Issue inside the app; without it, a row opens with a full page load. */
  onOpen?: (href: string) => void;
}) {
  const open = onOpen ?? ((href: string) => window.location.assign(href));
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
    if (event.key === "Enter") open(href);
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("[data-issue-row]"));
    rows[
      Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
    ]?.focus();
  }
  const sortableHead = (sort: IssueSort, label: string, className?: string) => (
    <th className={className} aria-sort={filters.sort === sort ? "descending" : undefined}>
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
    </th>
  );
  return (
    <div className="overflow-x-auto">
      <table className="issues-list-table table">
        <thead>
          <tr>
            {selection ? (
              <th className="issue-col-select">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  aria-label="选择本页全部问题"
                  checked={selectedCount > 0 && selectedCount === issues.length}
                  ref={(element) => {
                    if (element)
                      element.indeterminate = selectedCount > 0 && selectedCount < issues.length;
                  }}
                  onChange={() =>
                    selection.onChange(
                      selectedCount === issues.length
                        ? new Set()
                        : new Set(issues.map((issue) => issue.fingerprint)),
                    )
                  }
                />
              </th>
            ) : null}
            <th>问题</th>
            {sortableHead("trend", "趋势", "issue-col-trend")}
            {sortableHead("events", "事件", "issue-col-number")}
            {sortableHead("users", "用户", "issue-col-number")}
            {sortableHead("last_seen", "最近发生", "issue-col-time")}
            {sortableHead("first_seen", "首次发生", "issue-col-time")}
            <th className="issue-col-assignee">负责人</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, index) => {
            const parameters = withTimePreset(serializeIssueFilters(filters));
            const href = `/projects/${encodeURIComponent(filters.projectId)}/issues/${encodeURIComponent(issue.fingerprint)}?${parameters.toString()}`;
            const isNew = isNewInRange(issue.firstSeenAt, filters.from);
            const location = [issue.culprit?.function, issue.culprit?.file]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr
                key={issue.fingerprint}
                data-issue-row
                data-selected={selection?.selected.has(issue.fingerprint) || undefined}
                tabIndex={index === 0 ? 0 : -1}
                aria-label={`${issueStatusLabel[issue.status]}：${issue.title}`}
                className="cursor-pointer hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                onClick={(event) => {
                  if (
                    (event.target as HTMLElement).closest("a, button") ||
                    window.getSelection()?.toString()
                  )
                    return;
                  if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
                  else open(href);
                }}
                onKeyDown={(event) => handleRowKey(event, index, href)}
              >
                {selection ? (
                  <td className="issue-col-select" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      aria-label={`选择问题：${issue.title}`}
                      checked={selection.selected.has(issue.fingerprint)}
                      onChange={(event) => toggle(issue.fingerprint, event.target.checked)}
                    />
                  </td>
                ) : null}
                <td>
                  <div className="issue-list-heading-line">
                    <a
                      className="issue-list-title link link-hover"
                      href={href}
                      title={issue.title}
                      onClick={(event) => {
                        // Modified clicks keep the browser's new-tab and new-window behavior.
                        if (
                          !onOpen ||
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        onOpen(href);
                      }}
                    >
                      {issue.title}
                    </a>
                    {isNew ? (
                      <span
                        className="badge badge-warning badge-sm shrink-0"
                        title={`首次发生在 ${formatAbsoluteTime(issue.firstSeenAt)}，在当前时间范围内`}
                      >
                        新
                      </span>
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
                </td>
                <td className="issue-col-trend">
                  <Sparkline
                    values={issue.trend ?? []}
                    color={
                      issue.status === "unresolved" || issue.status === "regressed"
                        ? "var(--ds-chart-1)"
                        : "var(--ds-text-muted)"
                    }
                    className="h-8 w-[88px]"
                  />
                </td>
                <td className="issue-col-number font-medium tabular-nums">
                  {issue.events.toLocaleString()}
                </td>
                <td className="issue-col-number tabular-nums">{issue.users.toLocaleString()}</td>
                <td className="issue-col-time">
                  <time dateTime={issue.lastSeenAt} title={formatAbsoluteTime(issue.lastSeenAt)}>
                    {formatRelativeTime(issue.lastSeenAt)}
                  </time>
                </td>
                <td className="issue-col-time">
                  <time dateTime={issue.firstSeenAt} title={formatAbsoluteTime(issue.firstSeenAt)}>
                    {formatRelativeTime(issue.firstSeenAt)}
                  </time>
                </td>
                {/* The picker's menu is portalled, but React still bubbles its events through here. */}
                <td className="issue-col-assignee" onClick={(event) => event.stopPropagation()}>
                  <AssigneeCell issue={issue} assignment={assignment} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  const current = issue.assigneeUserId ?? "";
  return (
    <DaisyDropdown
      label={`${label}，更换负责人`}
      title={label}
      triggerClassName="issue-assignee-trigger btn btn-ghost btn-sm"
      menuClassName="max-h-80 w-56 flex-nowrap overflow-y-auto"
      trigger={face}
    >
      {(close) => (
        <>
          <li>
            <button
              type="button"
              className={cn(!current && "menu-active")}
              onClick={() => {
                close();
                if (current) onAssign(issue, "");
              }}
            >
              未分配
            </button>
          </li>
          {assignment.members?.map((member) => (
            <li key={member.userId}>
              <button
                type="button"
                className={cn(current === member.userId && "menu-active")}
                onClick={() => {
                  close();
                  if (current !== member.userId) onAssign(issue, member.userId);
                }}
              >
                <MemberLabel member={member} />
              </button>
            </li>
          ))}
        </>
      )}
    </DaisyDropdown>
  );
}
