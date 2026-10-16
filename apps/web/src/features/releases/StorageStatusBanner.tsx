import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SourceMapStatus } from "@/lib/api/releases";
import { OBJECT_STORAGE_SETTINGS_PATH } from "./releaseLinks";

/**
 * Tells members up front when uploads cannot work, instead of after the first failure. Working
 * storage that merely refuses deletes is not shown here: it blocks nothing, so it is said where a
 * delete happens (see ReleaseArtifactsCard).
 */
export function StorageStatusBanner({
  storage,
  instanceAdmin,
}: {
  storage: SourceMapStatus["storage"] | undefined;
  instanceAdmin: boolean;
}) {
  if (!storage || storage === "ready") return null;
  const notConfigured = storage === "not_configured";
  return (
    <Alert variant={notConfigured ? "warning" : "destructive"}>
      <TriangleAlertIcon />
      <AlertTitle>{notConfigured ? "尚未配置对象存储" : "对象存储暂不可用"}</AlertTitle>
      <AlertDescription>
        <p>
          {notConfigured
            ? "Source Map 只保存在实例的私有对象存储中，配置完成前无法上传。"
            : "已配置的对象存储当前无法连接，上传和还原会暂停，恢复后自动继续。"}
          {instanceAdmin ? null : "请联系实例管理员处理。"}
        </p>
        {instanceAdmin ? (
          <a className="font-medium text-foreground underline" href={OBJECT_STORAGE_SETTINGS_PATH}>
            {notConfigured ? "前往配置对象存储" : "检查对象存储设置"}
          </a>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
