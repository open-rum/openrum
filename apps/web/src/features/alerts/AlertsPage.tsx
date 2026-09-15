import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellRingIcon, CheckCircle2Icon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { createAlert, getAlerts, type AlertRule } from "@/lib/api/alerts";

const recommended: Array<Omit<AlertRule, "id" | "projectId"> & { description: string }> = [
  {
    name: "错误率突增",
    description: "5 分钟错误率达到 2%",
    metric: "error_rate",
    comparator: "gte",
    threshold: 2,
    windowMinutes: 5,
    cooldownMinutes: 30,
    environment: "production",
    enabled: true,
  },
  {
    name: "API 失败率过高",
    description: "10 分钟 API 失败率达到 5%",
    metric: "api_failure_rate",
    comparator: "gte",
    threshold: 5,
    windowMinutes: 10,
    cooldownMinutes: 30,
    environment: "production",
    enabled: true,
  },
  {
    name: "LCP 体验退化",
    description: "15 分钟 LCP P75 达到 2.5 秒",
    metric: "lcp_p75",
    comparator: "gte",
    threshold: 2500,
    windowMinutes: 15,
    cooldownMinutes: 60,
    environment: "production",
    enabled: true,
  },
];

export function AlertsPage() {
  const projectId = projectIdFromPathname(window.location.pathname);
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project)
    return (
      <ConsolePage width="wide">
        <ConsolePageHeader title="告警中心" description="请先接入项目。" />
      </ConsolePage>
    );
  return <ProjectAlerts project={project} />;
}

function ProjectAlerts({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["alerts", project.id],
    queryFn: ({ signal }) => getAlerts(project.id, signal),
  });
  const create = useMutation({
    mutationFn: (rule: Omit<AlertRule, "id" | "projectId">) => createAlert(project.id, rule),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["alerts", project.id] }),
  });
  return (
    <ConsolePage width="wide">
      <ConsolePageHeader
        title="告警中心"
        description="固定窗口、冷却去重，并把通知带回同一项目与筛选上下文。"
        actions={
          <Button asChild variant="outline">
            <Link to="/settings/channels">
              <BellRingIcon data-icon="inline-start" />
              通知渠道
            </Link>
          </Button>
        }
      />
      <ConsolePageContent>
        {query.error || create.error ? (
          <div>
            <AsyncError
              error={query.error ?? create.error}
              title="告警操作失败"
              remediation="现有规则未改变；检查通知渠道后重新加载。"
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : null}
        <section className="mt-6">
          <h2 className="text-lg font-semibold">推荐规则</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {recommended.map(({ description, ...rule }) => {
              const exists = query.data?.rules.some((item) => item.name === rule.name);
              return (
                <Card key={rule.name}>
                  <CardHeader>
                    <CardTitle className="text-base">{rule.name}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      className="w-full"
                      variant={exists ? "outline" : "default"}
                      disabled={exists || create.isPending}
                      onClick={() => create.mutate(rule)}
                    >
                      {exists ? <CheckCircle2Icon /> : <PlusIcon />}
                      {exists ? "已启用" : "启用规则"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
        <section className="mt-8 overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold">最近通知</h2>
            <p className="mt-1 text-xs text-muted-foreground">同一规则窗口只显示一条通知</p>
          </div>
          <div className="divide-y divide-border">
            {query.data?.notifications.length ? (
              query.data.notifications.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">BREACHED</Badge>
                      <strong className="text-sm">{item.title}</strong>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      观测值 {item.value.toLocaleString()} · 阈值 {item.threshold.toLocaleString()}{" "}
                      · {new Date(item.occurredAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <a href={item.deepLink}>
                      进入诊断 <ExternalLinkIcon />
                    </a>
                  </Button>
                </article>
              ))
            ) : (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                规则触发后，通知会出现在这里并包含诊断入口。
              </p>
            )}
          </div>
        </section>
      </ConsolePageContent>
    </ConsolePage>
  );
}
