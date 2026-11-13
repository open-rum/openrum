import { useNavigate } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AnalysisTab = "overview" | "events" | "funnels" | "paths" | "retention";

// These tabs switch routes, not panels: there is no TabsContent, so Radix's aria-controls would
// point at an element that does not exist.
const noPanel = { "aria-controls": undefined } as const;

export function AnalysisTabs({ projectId, active }: { projectId: string; active: AnalysisTab }) {
  const navigate = useNavigate();

  const changeTab = (tab: string) => {
    if (tab === "overview") {
      void navigate({
        to: "/projects/$projectId/analytics",
        params: { projectId },
      });
      return;
    }
    if (tab === "events") {
      void navigate({
        to: "/projects/$projectId/analytics/events",
        params: { projectId },
      });
      return;
    }
    if (tab === "funnels") {
      void navigate({
        to: "/projects/$projectId/analytics/funnels",
        params: { projectId },
      });
      return;
    }
    if (tab === "paths") {
      void navigate({
        to: "/projects/$projectId/analytics/paths",
        params: { projectId },
      });
      return;
    }
    if (tab === "retention") {
      void navigate({
        to: "/projects/$projectId/analytics/retention",
        params: { projectId },
      });
    }
  };

  return (
    <Tabs value={active} onValueChange={changeTab}>
      <TabsList variant="line" aria-label="分析功能">
        <TabsTrigger value="overview" {...noPanel}>
          总览
        </TabsTrigger>
        <TabsTrigger value="events" {...noPanel}>
          事件
        </TabsTrigger>
        <TabsTrigger value="funnels" {...noPanel}>
          漏斗
        </TabsTrigger>
        <TabsTrigger value="paths" {...noPanel}>
          路径
        </TabsTrigger>
        <TabsTrigger value="retention" {...noPanel}>
          留存
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
