import { FlaskConicalIcon } from "lucide-react";
import { useId } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { MOCK_DATA_AVAILABLE } from "./mockData";

/**
 * The preview-data switch under a page title. It renders nothing outside development builds,
 * and stays on screen while preview data shows, so it is never mistaken for project data.
 */
export function MockDataNotice({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const id = useId();
  if (!MOCK_DATA_AVAILABLE) return null;
  return (
    <Alert
      role="status"
      variant={enabled ? "warning" : "info"}
      className="items-center has-[>svg]:grid-cols-[auto_1fr_auto]"
    >
      <FlaskConicalIcon aria-hidden="true" />
      <AlertTitle>{enabled ? "当前显示模拟数据" : "开发环境"}</AlertTitle>
      <AlertDescription className="col-start-2">
        {enabled
          ? "页面数据由浏览器生成，仅用于预览页面效果，不代表项目真实数据。"
          : "可启用模拟数据以预览页面效果。模拟数据不会写入项目。"}
      </AlertDescription>
      <label
        htmlFor={id}
        className="col-start-3 row-span-2 row-start-1 flex cursor-pointer items-center gap-2 text-sm"
      >
        使用模拟数据
        <Switch id={id} size="sm" checked={enabled} onCheckedChange={onChange} />
      </label>
    </Alert>
  );
}
