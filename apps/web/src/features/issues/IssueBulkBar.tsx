import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, EyeOffIcon, RotateCcwIcon, UserRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      <Button size="sm" disabled={busy} onClick={() => mutation.mutate({ status: "resolved" })}>
        <CheckIcon data-icon="inline-start" />
        标记解决
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => mutation.mutate({ status: "ignored" })}
      >
        <EyeOffIcon data-icon="inline-start" />
        忽略
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => mutation.mutate({ status: "unresolved" })}
      >
        <RotateCcwIcon data-icon="inline-start" />
        重新打开
      </Button>
      {/* Controlled and always empty, so the control keeps reading 「分配给…」 after a pick. */}
      <Select
        value=""
        disabled={busy || members.isLoading || Boolean(members.error)}
        onValueChange={(value) =>
          mutation.mutate({ assigneeUserId: value === "none" ? "" : value })
        }
      >
        <SelectTrigger
          size="sm"
          aria-label="批量分配负责人"
          title={members.error ? "成员列表加载失败，暂不可分配" : "分配给…"}
        >
          <UserRoundIcon data-icon="inline-start" />
          <SelectValue placeholder="分配给…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="none">未分配</SelectItem>
            {members.data?.members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.displayName || member.email}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
        取消选择
      </Button>
    </div>
  );
}
