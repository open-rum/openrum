import { FlaskConicalIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/api/projects";
import { useDevDataDialog } from "./devDataDialog";

export default function DevDataNotice({ project }: { project: Project }) {
  const openDialog = useDevDataDialog();
  if (!import.meta.env.DEV || !openDialog) return null;
  return (
    <Alert variant="info" role="status" className="items-center">
      <FlaskConicalIcon aria-hidden="true" />
      <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <AlertTitle>想先看看效果？</AlertTitle>
          <AlertDescription>开发环境可向当前项目写入测试数据，体验图表和列表。</AlertDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start sm:self-center"
          onClick={() => openDialog(project)}
        >
          添加测试数据
        </Button>
      </div>
    </Alert>
  );
}
