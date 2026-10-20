import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserAvatar } from "@/components/account/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  approveJoinRequest,
  createInvitation,
  invitationsQueryKey,
  rejectJoinRequest,
  revokeInvitation,
  type Invitation,
  type JoinRequest,
} from "@/lib/api/invitations";
import type { OrganizationRole } from "@/lib/api/projects";
import { roleLabels } from "./roleLabels";

const cell = "px-4 py-3 max-sm:p-0";

/** People who followed an invitation link and are waiting to be let in. */
export function JoinRequestsPanel({
  organizationId,
  requests,
  roles,
}: {
  organizationId: string;
  requests: JoinRequest[];
  /** What the viewer may grant; an Admin cannot hand out Owner. */
  roles: OrganizationRole[];
}) {
  const queryClient = useQueryClient();
  // The role each request will get; until changed, the one its invitation offered.
  const [chosen, setChosen] = useState<Record<string, OrganizationRole>>({});
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ["organization-join-requests", organizationId],
    });
    void queryClient.invalidateQueries({ queryKey: ["organization-members", organizationId] });
  };
  const approve = useMutation({
    mutationFn: ({ request, role }: { request: JoinRequest; role: OrganizationRole }) =>
      approveJoinRequest(organizationId, request.id, role),
    onSuccess: (_, { request }) => {
      toast.success(`已通过 ${request.displayName} 的申请`);
      refresh();
    },
  });
  const reject = useMutation({
    mutationFn: (request: JoinRequest) => rejectJoinRequest(organizationId, request.id),
    onSuccess: (_, request) => {
      toast.success(`已拒绝 ${request.displayName} 的申请`);
      refresh();
    },
  });
  const error = approve.error ?? reject.error;
  const busy = approve.isPending || reject.isPending;

  if (!requests.length) {
    return (
      <p className="border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        没有待处理的加入申请。对方通过邀请链接注册或登录后提交申请，会出现在这里。
      </p>
    );
  }
  return (
    <div className="border border-border bg-card">
      {error ? (
        <p className="border-b border-border px-4 py-3 text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
      <table className="w-full border-collapse text-left text-sm">
        <thead className="hidden bg-muted/60 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:table-header-group">
          <tr>
            <th className="px-4 py-3">申请人</th>
            <th className="px-4 py-3">通过后的角色</th>
            <th className="px-4 py-3">申请时间</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {requests.map((request) => {
            const role = chosen[request.id] ?? request.role;
            return (
              <tr
                key={request.id}
                className="hover:bg-muted/30 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-y-3 max-sm:p-4"
              >
                <td className={`${cell} max-sm:col-span-2`}>
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      userId={request.userId}
                      name={request.displayName}
                      avatar={request.avatar}
                    />
                    <div className="min-w-0">
                      <strong className="block font-medium text-foreground">
                        {request.displayName}
                      </strong>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {request.email}
                      </span>
                    </div>
                  </div>
                </td>
                <td className={cell}>
                  <Select
                    value={role}
                    disabled={busy}
                    onValueChange={(value) =>
                      setChosen((current) => ({
                        ...current,
                        [request.id]: value as OrganizationRole,
                      }))
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="min-w-28"
                      aria-label={`${request.displayName} 通过后的角色`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((item) => (
                        <SelectItem key={item} value={item}>
                          {roleLabels[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className={`${cell} text-muted-foreground max-sm:hidden`}>
                  {formatDateTime(request.createdAt)}
                </td>
                <td className={`${cell} text-right`}>
                  <span className="inline-flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`拒绝 ${request.displayName}`}
                      onClick={() => reject.mutate(request)}
                    >
                      拒绝
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      aria-label={`通过 ${request.displayName}`}
                      onClick={() => approve.mutate({ request, role })}
                    >
                      通过
                    </Button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The links that still work. A link's secret is not kept, so one cannot be copied again. */
export function InvitationsPanel({
  organizationId,
  invitations,
}: {
  organizationId: string;
  invitations: Invitation[];
}) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: invitationsQueryKey(organizationId) });
  const revoke = useMutation({
    mutationFn: (invitation: Invitation) => revokeInvitation(organizationId, invitation.id),
    onSuccess: () => {
      toast.success("已撤销，链接立即失效");
      void refresh();
    },
  });
  // A new link goes out first. Only once it has been sent is the old one revoked; if the mail
  // did not go, the new link is withdrawn instead and the old one keeps working.
  const resend = useMutation({
    mutationFn: async (invitation: Invitation) => {
      const made = await createInvitation(organizationId, {
        role: invitation.role,
        email: invitation.email ?? undefined,
      });
      if (!made.delivery?.success) {
        await revokeInvitation(organizationId, made.invitation.id);
        throw new Error(`邮件没有发出去：${made.delivery?.message ?? "未知原因"}`);
      }
      await revokeInvitation(organizationId, invitation.id);
      return made;
    },
    onSuccess: (_, invitation) => toast.success(`已重新发送到 ${invitation.email}`),
    onSettled: () => void refresh(),
  });
  const error = revoke.error ?? resend.error;
  const busy = revoke.isPending || resend.isPending;

  if (!invitations.length) {
    return (
      <p className="border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        没有有效的邀请链接。点击右上角的「邀请成员」生成。
      </p>
    );
  }
  return (
    <div className="border border-border bg-card">
      {error ? (
        <p className="border-b border-border px-4 py-3 text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
      <table className="w-full border-collapse text-left text-sm">
        <thead className="hidden bg-muted/60 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:table-header-group">
          <tr>
            <th className="px-4 py-3">发给</th>
            <th className="px-4 py-3">角色</th>
            <th className="px-4 py-3">邀请人</th>
            <th className="px-4 py-3">到期</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invitations.map((invitation) => (
            <tr
              key={invitation.id}
              className="hover:bg-muted/30 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-y-3 max-sm:p-4"
            >
              <td className={`${cell} max-sm:col-span-2`}>
                {invitation.email ? (
                  <span className="font-medium text-foreground">{invitation.email}</span>
                ) : (
                  <span className="text-muted-foreground">仅链接</span>
                )}
              </td>
              <td className={cell}>{roleLabels[invitation.role]}</td>
              <td className={`${cell} text-muted-foreground max-sm:hidden`}>
                {invitation.createdByName ?? "已删除的用户"}
              </td>
              <td className={`${cell} text-muted-foreground max-sm:hidden`}>
                {formatDateTime(invitation.expiresAt)}
              </td>
              <td className={`${cell} text-right`}>
                <span className="inline-flex gap-2">
                  {invitation.email ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`重新发送给 ${invitation.email}`}
                      onClick={() => resend.mutate(invitation)}
                    >
                      重发
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`撤销发给 ${invitation.email ?? "任何人"} 的邀请`}
                    onClick={() => {
                      if (window.confirm("撤销后这条链接立即失效，确认撤销？")) {
                        revoke.mutate(invitation);
                      }
                    }}
                  >
                    撤销
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
