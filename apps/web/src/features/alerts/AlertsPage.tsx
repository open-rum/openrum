import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { BellRingIcon, PlusIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
  ConsolePageTabs,
} from "@/components/layout/ConsolePage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  deleteAlert,
  getAlerts,
  getChannels,
  updateAlert,
  type AlertRule,
  type DeliveryState,
} from "@/lib/api/alerts";
import { getProject, listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { readRecentProjectId } from "@/lib/projects/currentProject";
import { AlertOverview } from "./AlertOverview";
import { alertOverview, ruleAttentions, type RuleFilter } from "./alertPresentation";
import { DeliveryLog } from "./DeliveryLog";
import { RuleEditor, type RuleEditorState } from "./RuleEditor";
import { RulesTable } from "./RulesTable";
import { RuleDetails } from "./RuleDetails";

type AlertsTab = "rules" | "history";

function readTab(): AlertsTab {
  return new URLSearchParams(window.location.search).get("tab") === "history" ? "history" : "rules";
}

export function AlertsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId!, signal),
    enabled: Boolean(projectId),
  });
  if (!projectId) return <LegacyAlertsRedirect />;
  if (project.isPending) return <AlertsSkeleton />;
  if (project.error || !project.data)
    return (
      <ConsolePage width="wide">
        <AsyncError
          error={project.error}
          title="无法加载项目"
          remediation="请确认你仍是该项目所在组织的成员。"
          onRetry={() => void project.refetch()}
        />
      </ConsolePage>
    );
  return <ProjectAlerts key={project.data.id} project={project.data} />;
}

/** The old /alerts address opens the alerts of the most recently used project. */
function LegacyAlertsRedirect() {
  const navigate = useNavigate();
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const list = projects.data?.projects ?? [];
  const target =
    list.find((item) => organization && item.id === readRecentProjectId(organization.id)) ??
    list[0];
  useEffect(() => {
    if (target)
      void navigate({
        to: "/projects/$projectId/alerts",
        params: { projectId: target.id },
        replace: true,
      });
  }, [navigate, target]);
  if (projects.data && !target)
    return (
      <ConsolePage width="wide">
        <ConsolePageHeader title="告警" description="请先创建并接入一个项目。" />
      </ConsolePage>
    );
  return <AlertsSkeleton />;
}

function AlertsSkeleton() {
  return (
    <ConsolePage width="wide" aria-label="正在加载告警">
      <Skeleton className="h-16" />
      <Skeleton className="h-64" />
    </ConsolePage>
  );
}

export function ProjectAlerts({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const alertsKey = ["alerts", project.id] as const;
  const alerts = useQuery({
    queryKey: alertsKey,
    queryFn: ({ signal }) => getAlerts(project.id, signal),
    refetchInterval: 30_000,
  });
  const channels = useQuery({
    queryKey: ["channels", project.organizationId],
    queryFn: ({ signal }) => getChannels(project.organizationId, signal),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: alertsKey });
  const [tab, setTab] = useState<AlertsTab>(readTab);
  const [editor, setEditor] = useState<RuleEditorState | null>(null);
  const [removing, setRemoving] = useState<AlertRule | null>(null);
  const [notice, setNotice] = useState("");
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [historyRuleId, setHistoryRuleId] = useState("all");
  const [historyDelivery, setHistoryDelivery] = useState<"all" | DeliveryState>("all");
  const [ruleFilter, setRuleFilter] = useState<RuleFilter>("all");
  const canManage = alerts.data?.canManage ?? false;
  // Every project accepts the fixed environments, so new rules watch production.
  const defaultEnvironment = "production";

  function changeTab(next: string) {
    const value: AlertsTab = next === "history" ? "history" : "rules";
    setTab(value);
    const url = new URL(window.location.href);
    if (value === "rules") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", url);
  }

  const toggle = useMutation({
    mutationFn: (rule: AlertRule) => updateAlert(project.id, rule.id, { enabled: !rule.enabled }),
    onSuccess: (_, rule) => {
      setNotice(`已${rule.enabled ? "停用" : "启用"}规则「${rule.name}」。`);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (rule: AlertRule) => deleteAlert(project.id, rule.id),
    onSuccess: (_, rule) => {
      setRemoving(null);
      setNotice(`已删除规则「${rule.name}」。`);
      void refresh();
    },
  });

  const rules = alerts.data?.rules ?? [];
  const notifications = alerts.data?.notifications ?? [];
  const channelList = channels.data?.channels ?? [];
  const mutationFailure = toggle.error ?? remove.error;
  const canEdit = canManage && channels.isSuccess;
  const inspecting = rules.find((rule) => rule.id === inspectingId);
  const attention = ruleAttentions(rules, notifications, channelList, channels.isSuccess);
  const overview = alertOverview(rules, notifications, attention);
  const noChannel = channels.isSuccess && !channelList.some((channel) => channel.enabled);
  const firstRun = Boolean(alerts.data) && rules.length === 0;
  const showRules = (filter: RuleFilter) => {
    setRuleFilter(filter);
    changeTab("rules");
  };
  const showHistory = (delivery: "all" | DeliveryState) => {
    setHistoryRuleId("all");
    setHistoryDelivery(delivery);
    changeTab("history");
  };

  return (
    <ConsolePage width="wide">
      <ConsolePageHeader
        title="告警"
        description="管理告警规则，查看触发记录与送达结果。"
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/settings/org/channels">
                <BellRingIcon data-icon="inline-start" />
                通知渠道
                {noChannel ? (
                  <span className="badge badge-sm badge-soft badge-warning">未配置</span>
                ) : null}
              </Link>
            </Button>
            {canManage ? (
              <Button disabled={!canEdit} onClick={() => setEditor({ mode: "create" })}>
                <PlusIcon data-icon="inline-start" />
                新建规则
              </Button>
            ) : null}
          </>
        }
      />
      {alerts.data && rules.length ? (
        <AlertOverview
          overview={overview}
          onShowBreached={() => showRules("breached")}
          onShowTriggers={() => showHistory("all")}
          onShowFailures={() =>
            showHistory(
              notifications.some((item) => item.delivery === "partial") ? "all" : "failed",
            )
          }
          onShowAttention={() => showRules("attention")}
        />
      ) : null}
      <Tabs value={tab} onValueChange={changeTab} className="gap-[var(--page-gap)]">
        <ConsolePageTabs>
          <TabsList variant="line">
            <TabsTrigger value="rules">
              告警规则
              {alerts.data && !firstRun ? <TabsCount>{rules.length}</TabsCount> : null}
            </TabsTrigger>
            <TabsTrigger value="history">
              触发记录
              {alerts.data && !firstRun ? <TabsCount>{notifications.length}</TabsCount> : null}
            </TabsTrigger>
          </TabsList>
        </ConsolePageTabs>
        <ConsolePageContent className="flex flex-col gap-4">
          {mutationFailure ? (
            <AsyncError
              error={mutationFailure}
              title="告警操作失败"
              remediation="操作结果尚未确认，请先重试读取规则，再决定是否重新操作。"
              onRetry={() => {
                toggle.reset();
                remove.reset();
                void refresh();
              }}
            />
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {channels.error ? (
            <AsyncError
              error={channels.error}
              title="通知渠道读取失败"
              remediation="仍可查看规则与触发记录；恢复渠道信息后可编辑规则。"
              onRetry={() => void channels.refetch()}
            />
          ) : null}
          {alerts.error ? (
            <AsyncError
              error={alerts.error}
              title="告警数据加载失败"
              remediation="无法确认当前规则和触发情况，请重试。"
              onRetry={() => void alerts.refetch()}
            />
          ) : null}
          {alerts.isPending ? (
            <Skeleton className="h-64" />
          ) : alerts.data ? (
            <>
              <TabsContent value="rules">
                <RulesTable
                  rules={rules}
                  channels={channelList}
                  notifications={notifications}
                  filter={ruleFilter}
                  onFilterChange={setRuleFilter}
                  canManage={canManage}
                  canCreate={canEdit}
                  channelsAvailable={channels.isSuccess}
                  onInspect={(rule) => setInspectingId(rule.id)}
                  defaultEnvironment={defaultEnvironment}
                  toggling={toggle.isPending}
                  onCreate={(initial) => setEditor({ mode: "create", initial })}
                  onEdit={(rule) => setEditor({ mode: "edit", rule })}
                  onDuplicate={(rule) => setEditor({ mode: "duplicate", rule })}
                  onToggle={(rule) => toggle.mutate(rule)}
                  onDelete={setRemoving}
                />
              </TabsContent>
              <TabsContent value="history">
                <DeliveryLog
                  key={`${historyRuleId}-${historyDelivery}`}
                  initialRuleId={historyRuleId}
                  initialDelivery={historyDelivery}
                  notifications={notifications}
                  rules={rules}
                  onShowRules={() => changeTab("rules")}
                />
              </TabsContent>
            </>
          ) : null}
        </ConsolePageContent>
      </Tabs>

      {inspecting ? (
        <RuleDetails
          rule={inspecting}
          channels={channelList}
          notifications={notifications}
          canManage={canEdit}
          channelsAvailable={channels.isSuccess}
          onClose={() => setInspectingId(null)}
          onEdit={() => {
            setInspectingId(null);
            setEditor({ mode: "edit", rule: inspecting });
          }}
          onHistory={() => {
            setHistoryRuleId(inspecting.id);
            setHistoryDelivery("all");
            setInspectingId(null);
            changeTab("history");
          }}
        />
      ) : null}
      {editor ? (
        <RuleEditor
          key={editor.mode === "create" ? "create" : `${editor.mode}-${editor.rule.id}`}
          project={project}
          state={editor}
          rules={rules}
          channels={channelList}
          canManageChannels={channels.data?.canManage ?? false}
          defaultEnvironment={defaultEnvironment}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            setNotice(message);
            changeTab("rules");
            void refresh();
          }}
        />
      ) : null}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除规则「{removing?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              规则和它的评估、通知记录会一并删除，无法恢复。只想暂时不通知的话，可以关闭启用开关。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (removing) remove.mutate(removing);
              }}
            >
              删除规则
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConsolePage>
  );
}
