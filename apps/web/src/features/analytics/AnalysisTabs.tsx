import { useNavigate } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AnalysisTab = "overview" | "funnels" | "paths" | "retention";

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
    <Tabs className="analysis-tabs" value={active} onValueChange={changeTab}>
      <TabsList variant="line" aria-label="分析功能">
        <TabsTrigger value="overview">总览</TabsTrigger>
        <TabsTrigger value="funnels">漏斗</TabsTrigger>
        <TabsTrigger value="paths">路径</TabsTrigger>
        <TabsTrigger value="retention">留存</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
