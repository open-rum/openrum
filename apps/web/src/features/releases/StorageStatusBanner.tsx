import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SourceMapStatus } from "@/lib/api/releases";
import { OBJECT_STORAGE_SETTINGS_PATH } from "./releaseLinks";

/** Tells members up front when uploads cannot work, instead of after the first failure. */
export function StorageStatusBanner({
  storage,
  deleteAllowed = true,
  instanceAdmin,
}: {
  storage: SourceMapStatus["storage"] | undefined;
  deleteAllowed?: boolean;
  instanceAdmin: boolean;
}) {
  if (storage === "ready" && !deleteAllowed) {
    // Storage works; only deletions are limited, so this informs rather than blocks.
    return (
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertTitle>对象存储没有删除权限</AlertTitle>
        <AlertDescription>
          <p>
            上传和堆栈还原不受影响。删除文件、版本或项目时，存储桶中的文件会保留，需要在存储桶中自行清理，或配置生命周期规则。
            {instanceAdmin ? null : "如需开启删除，请联系实例管理员。"}
          </p>
          {instanceAdmin ? (
            <a
              className="font-medium text-foreground underline"
              href={OBJECT_STORAGE_SETTINGS_PATH}
            >
              检查对象存储设置
            </a>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }
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
