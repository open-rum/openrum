import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Key, Plus, Trash, UsersThree } from "@phosphor-icons/react";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { Button } from "@/components/ui/button";
import {
  addMember,
  canManageMembers,
  listMembers,
  listOrganizations,
  listProjects,
  removeMember,
  updateMemberRole,
  type OrganizationRole,
} from "@/lib/api/projects";
import { sessionQueryOptions } from "@/lib/auth/session";
import { AccountSettingsNav } from "./AccountSettingsNav";

const roleLabels: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export function MembersPage() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useSuspenseQuery(sessionQueryOptions());
  const [organizationId, setOrganizationId] = useState("");
  const organizationsQuery = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organizations = useMemo(
    () => organizationsQuery.data?.organizations ?? [],
    [organizationsQuery.data],
  );
  const activeOrganizationId = organizationId || organizations[0]?.id || "";
  const organization = organizations.find((item) => item.id === activeOrganizationId);
  const membersQuery = useQuery({
    queryKey: ["organization-members", activeOrganizationId],
    queryFn: () => listMembers(activeOrganizationId),
    enabled: Boolean(activeOrganizationId),
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", activeOrganizationId],
    queryFn: () => listProjects(activeOrganizationId),
    enabled: Boolean(activeOrganizationId),
  });
  const canManage = organization ? canManageMembers(organization.role) : false;
  const refreshMembers = () =>
    queryClient.invalidateQueries({ queryKey: ["organization-members", activeOrganizationId] });
  const addMutation = useMutation({
    mutationFn: (input: { email: string; role: OrganizationRole }) =>
      addMember(activeOrganizationId, input),
    onSuccess: () => void refreshMembers(),
  });
  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrganizationRole }) =>
      updateMemberRole(activeOrganizationId, userId, role),
    onSuccess: () => void refreshMembers(),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(activeOrganizationId, userId),
    onSuccess: () => void refreshMembers(),
  });
  const mutationError = addMutation.error ?? roleMutation.error ?? removeMutation.error;
  const busy = addMutation.isPending || roleMutation.isPending || removeMutation.isPending;

  return (
    <ConsolePage width="wide" rail={<AccountSettingsNav />} railLabel="账户设置">
      <ConsolePageHeader
        title="成员与权限"
        description="角色权限在服务端逐 API 校验；组织始终必须保留至少一名 Owner。"
        actions={
          <label className="text-sm font-medium text-foreground">
            组织
            <select
              className="mt-2 block h-10 min-w-64 rounded-md border border-input bg-background px-3 text-sm"
              value={activeOrganizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {organizations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {roleLabels[item.role]}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {canManage ? (
            <form
              className="mb-5 grid gap-3 border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                addMutation.mutate({
                  email: String(form.get("email") ?? ""),
                  role: String(form.get("role") ?? "member") as OrganizationRole,
                });
              }}
            >
              <label className="text-sm font-medium">
                已有用户邮箱
                <input
                  name="email"
                  type="email"
                  required
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
                  placeholder="developer@company.com"
                />
              </label>
              <label className="text-sm font-medium">
                角色
                <select
                  name="role"
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue="member"
                >
                  {manageableRoles(organization?.role).map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" className="h-10" disabled={busy}>
                <Plus weight="bold" /> 添加成员
              </Button>
            </form>
          ) : (
            <p className="mb-5 border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              当前角色为 {organization?.role ?? "—"}，可以查看成员，但不能修改权限。
            </p>
          )}

          {mutationError ? (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {mutationError.message}
            </p>
          ) : null}

          {organizationsQuery.error ? (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {organizationsQuery.error.message}
            </p>
          ) : null}

          <div className="border border-border bg-card">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="hidden bg-muted/60 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:table-header-group">
                <tr>
                  <th className="px-4 py-3">成员</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">加入时间</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {membersQuery.isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                      正在加载成员…
                    </td>
                  </tr>
                ) : membersQuery.error ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-destructive">
                      {membersQuery.error.message}
                    </td>
                  </tr>
                ) : membersQuery.data?.members.length ? (
                  membersQuery.data.members.map((member) => {
                    const protectedOwner =
                      organization?.role !== "owner" && member.role === "owner";
                    const editable = canManage && !protectedOwner;
                    return (
                      <tr
                        key={member.userId}
                        className="hover:bg-muted/30 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-y-3 max-sm:p-4"
                      >
                        <td className="px-4 py-3 max-sm:col-span-2 max-sm:p-0">
                          <strong className="block font-medium text-foreground">
                            {member.displayName}
                            {member.userId === currentUser.userId ? "（你）" : ""}
                          </strong>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-sm:p-0">
                          <select
                            aria-label={`修改 ${member.displayName} 的角色`}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                            value={member.role}
                            disabled={!editable || busy}
                            onChange={(event) =>
                              roleMutation.mutate({
                                userId: member.userId,
                                role: event.target.value as OrganizationRole,
                              })
                            }
                          >
                            {(member.role === "owner" && protectedOwner
                              ? (["owner"] as OrganizationRole[])
                              : manageableRoles(organization?.role)
                            ).map((role) => (
                              <option key={role} value={role}>
                                {roleLabels[role]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground max-sm:hidden">
                          {formatDate(member.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right max-sm:p-0">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="destructive"
                            aria-label={`移除 ${member.displayName}`}
                            disabled={!editable || busy}
                            onClick={() => {
                              if (window.confirm(`确认从组织中移除 ${member.displayName}？`)) {
                                removeMutation.mutate(member.userId);
                              }
                            }}
                          >
                            <Trash />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                      <UsersThree className="mx-auto mb-2 size-6" /> 暂无成员
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="border border-border bg-card p-5">
            <h2 className="text-base font-semibold">角色说明</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <RoleDescription role="Owner" text="全部权限；可配置 OIDC 和管理其他 Owner。" />
              <RoleDescription role="Admin" text="管理项目、Key、采样、成员和通知渠道。" />
              <RoleDescription role="Member" text="诊断问题与管理告警，不能修改项目权限。" />
              <RoleDescription role="Viewer" text="只读查看大盘、事件与分析结果。" />
            </dl>
          </div>
          <div className="border border-border bg-card p-5">
            <h2 className="text-base font-semibold">项目设置</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Origin、环境、保留与客户端 DSN 都按项目配置。
            </p>
            <div className="mt-3 space-y-2">
              {projectsQuery.data?.projects.map((project) => (
                <Button key={project.id} asChild variant="outline" className="w-full justify-start">
                  <Link to="/projects/$projectId/settings" params={{ projectId: project.id }}>
                    <Key /> {project.name}
                  </Link>
                </Button>
              ))}
              {!projectsQuery.isLoading && !projectsQuery.data?.projects.length ? (
                <p className="text-sm text-muted-foreground">该组织还没有项目。</p>
              ) : null}
              {projectsQuery.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {projectsQuery.error.message}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </ConsolePage>
  );
}

function manageableRoles(actorRole: OrganizationRole | undefined): OrganizationRole[] {
  return actorRole === "owner"
    ? ["owner", "admin", "member", "viewer"]
    : ["admin", "member", "viewer"];
}

function RoleDescription({ role, text }: { role: string; text: string }) {
  return (
    <div>
      <dt className="font-medium text-foreground">{role}</dt>
      <dd className="mt-1 leading-5 text-muted-foreground">{text}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
