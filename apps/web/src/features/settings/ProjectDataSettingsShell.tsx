import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChartColumnIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsShell } from "./SettingsShell";
import { projectDataSettings, type ProjectDataSection } from "./projectDataSettings";

export function ProjectDataSettingsShell({
  projectId,
  section,
  children,
}: {
  projectId: string;
  section: ProjectDataSection;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const current = projectDataSettings.find((item) => item.key === section)!;
  return (
    <Tabs
      value={section}
      activationMode="manual"
      onValueChange={(value) => {
        const destination = projectDataSettings.find((item) => item.key === value);
        if (destination) void navigate({ to: destination.path, params: { projectId } });
      }}
    >
      <SettingsShell
        title="数据管理"
        description="统一配置采集比例、接收上限和数据处理规则。设置作用于当前项目的全部环境，各项独立保存。"
        width="wide"
        actions={
          <Button asChild variant="outline">
            <Link to="/settings/project/$projectId/usage" params={{ projectId }}>
              <ChartColumnIcon data-icon="inline-start" />
              查看用量
            </Link>
          </Button>
        }
        tabs={
          <div className="overflow-x-auto pb-2">
            <TabsList variant="line" aria-label="数据管理分区" className="min-h-11">
              {projectDataSettings.map((item) => (
                <TabsTrigger key={item.key} value={item.key} className="min-h-10 px-4">
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        }
      >
        <TabsContent value={section} className="flex flex-col gap-6">
          <div className="max-w-3xl">
            <h2 id={`project-${section}-title`} className="text-lg font-medium">
              {current.label}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{current.description}</p>
          </div>
          {children}
        </TabsContent>
      </SettingsShell>
    </Tabs>
  );
}
