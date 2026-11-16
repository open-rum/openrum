import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronDownIcon, EyeOffIcon, RotateCcwIcon, UserRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { MemberLabel } from "@/components/account/MemberLabel";
import { DaisyDropdown } from "@/components/daisy/DaisyDropdown";
import { batchUpdateIssues, type IssuesResponse, type StoredIssueStatus } from "@/lib/api/issues";
import { listMembers, type Project } from "@/lib/api/projects";

type Patch = { status?: StoredIssueStatus; assigneeUserId?: string };

/**
 * Replaces the list heading while rows are selected: one status or assignee change applied
 * to everything selected, in a single request.
 */
export function IssueBulkBar({
  project,
  selected,
  onClear,
}: {
  project: Project;
  selected: IssuesResponse["issues"];
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ["members", project.organizationId],
    queryFn: () => listMembers(project.organizationId),
  });
  const mutation = useMutation({
    mutationFn: (patch: Patch) => batchUpdateIssues(project.id, selected, patch),
    onSuccess: ({ updated }) => {
      toast.success(`已更新 ${updated} 个问题`);
      void queryClient.invalidateQueries({ queryKey: ["issues", project.id] });
      onClear();
    },
    onError: () => toast.error("批量更新失败，请稍后重试"),
  });
  const busy = mutation.isPending;
  return (
    <div className="issue-bulk-bar" role="toolbar" aria-label="批量操作">
      <strong aria-live="polite">已选 {selected.length} 个问题</strong>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={busy}
        onClick={() => mutation.mutate({ status: "resolved" })}
      >
        <CheckIcon className="size-4" aria-hidden="true" />
        标记解决
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() => mutation.mutate({ status: "ignored" })}
      >
        <EyeOffIcon className="size-4" aria-hidden="true" />
        忽略
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() => mutation.mutate({ status: "unresolved" })}
      >
        <RotateCcwIcon className="size-4" aria-hidden="true" />
        重新打开
      </button>
      <DaisyDropdown
        label="批量分配负责人"
        title={members.error ? "成员列表加载失败，暂不可分配" : "分配给…"}
        triggerClassName="btn btn-sm"
        menuClassName="max-h-80 w-56 flex-nowrap overflow-y-auto"
        placement="start"
        disabled={busy || members.isLoading || Boolean(members.error)}
        trigger={
          <>
            <UserRoundIcon className="size-4" aria-hidden="true" />
            分配给…
            <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
          </>
        }
      >
        {(close) => (
          <>
            <li>
              <button
                type="button"
                onClick={() => {
                  close();
                  mutation.mutate({ assigneeUserId: "" });
                }}
              >
                未分配
              </button>
            </li>
            {members.data?.members.map((member) => (
              <li key={member.userId}>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    mutation.mutate({ assigneeUserId: member.userId });
                  }}
                >
                  <MemberLabel member={member} />
                </button>
              </li>
            ))}
          </>
        )}
      </DaisyDropdown>
      <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={onClear}>
        取消选择
      </button>
    </div>
  );
}
