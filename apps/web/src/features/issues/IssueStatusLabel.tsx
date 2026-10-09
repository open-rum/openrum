import type { IssueStatus } from "@/lib/api/issues";
import { issueStatusLabel } from "./issueStatus";

/** A quiet dot plus text, so a page of unresolved Issues does not turn into a wall of red. */
export function IssueStatusLabel({ status }: { status: IssueStatus }) {
  return (
    <span className="issue-status" data-status={status}>
      <i aria-hidden="true" />
      {issueStatusLabel[status]}
    </span>
  );
}
