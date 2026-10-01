import { CheckCircle2Icon, KeyRoundIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { docsUrl } from "@/lib/docs";
import { quickStartSnippet, uploadTokensPath } from "./releaseLinks";

export function QuickStart({ projectId }: { projectId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vite 快速接入</CardTitle>
        <CardDescription>
          构建结束后插件上传隐藏的 Source Map，并从公开目录删除 .map 与 sourceMappingURL 注释。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <pre className="release-code">
          <code>{quickStartSnippet(window.location.origin, projectId)}</code>
        </pre>
        <p className="release-security">
          <KeyRoundIcon />
          <span>
            在 CI 中把上传令牌设为 <code>OPENRUM_UPLOAD_TOKEN</code>。
            <a href={uploadTokensPath(projectId)}>管理上传令牌</a>
          </span>
        </p>
        <p className="release-security">
          <CheckCircle2Icon />
          <span>
            release 与 dist 必须与 SDK 的 <code>init()</code> 一致。
            <a href={docsUrl("sdk/source-maps/")} target="_blank" rel="noreferrer">
              查看文档
            </a>
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
