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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteAlert, getAlerts, getChannels, updateAlert, type AlertRule } from "@/lib/api/alerts";
import { getProject, listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { readRecentProjectId } from "@/lib/projects/currentProject";
import { DeliveryLog } from "./DeliveryLog";
import { RuleEditor, type RuleEditorState } from "./RuleEditor";
import { RulesTable } from "./RulesTable";

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
  return <ProjectAlerts project={project.data} />;
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

function ProjectAlerts({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const alertsKey = ["alerts", project.id] as const;
  const alerts = useQuery({
    queryKey: alertsKey,
    queryFn: ({ signal }) => getAlerts(project.id, signal),
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
    onSuccess: () => void refresh(),
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
  const failure = alerts.error ?? toggle.error ?? remove.error;

  return (
    <ConsolePage width="wide">
      <ConsolePageHeader
        title="告警"
        description="规则按固定时间窗口评估，触发后通知到所选渠道，并带回对应的诊断页面。"
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/settings/org/channels">
                <BellRingIcon data-icon="inline-start" />
                通知渠道
              </Link>
            </Button>
            {canManage ? (
              <Button onClick={() => setEditor({ mode: "create" })}>
                <PlusIcon data-icon="inline-start" />
                新建规则
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs value={tab} onValueChange={changeTab}>
        <ConsolePageTabs>
          <TabsList variant="line">
            <TabsTrigger value="rules">规则 {alerts.data ? `· ${rules.length}` : ""}</TabsTrigger>
            <TabsTrigger value="history">
              通知记录 {alerts.data ? `· ${notifications.length}` : ""}
            </TabsTrigger>
          </TabsList>
        </ConsolePageTabs>
        <ConsolePageContent className="flex flex-col gap-4">
          {failure ? (
            <AsyncError
              error={failure}
              title="告警操作失败"
              remediation="现有规则未改变，请稍后重试。"
              onRetry={() => void refresh()}
            />
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {alerts.isPending ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              <TabsContent value="rules">
                <RulesTable
                  rules={rules}
                  channels={channelList}
                  canManage={canManage}
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
                <DeliveryLog notifications={notifications} rules={rules} />
              </TabsContent>
            </>
          )}
        </ConsolePageContent>
      </Tabs>

      {editor ? (
        <RuleEditor
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
