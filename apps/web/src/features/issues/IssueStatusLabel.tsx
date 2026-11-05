import type { IssueStatus } from "@/lib/api/issues";
import { issueStatusLabel } from "./issueStatus";

const statusTone: Record<IssueStatus, string> = {
  unresolved: "status-error",
  regressed: "status-warning",
  resolved: "status-success",
  ignored: "status-neutral",
};

/** daisyUI's status dot plus text, so a page of unresolved Issues does not turn into a wall of red. */
export function IssueStatusLabel({ status }: { status: IssueStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" data-status={status}>
      <span className={`status ${statusTone[status]}`} aria-hidden="true" />
      {issueStatusLabel[status]}
    </span>
  );
}
