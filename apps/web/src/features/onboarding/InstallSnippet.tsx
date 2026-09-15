import { useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type InstallSnippetProps = {
  dsn: string | null;
  environment: string;
};

export function InstallSnippet({ dsn, environment }: InstallSnippetProps) {
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(
    () => `import { init } from "@openrum/browser";

init({
  dsn: "${dsn ?? "<YOUR_DSN>"}",
  environment: "${environment}",
});`,
    [dsn, environment],
  );

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">安装并初始化 Browser SDK</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            在应用入口执行一次；DSN 已包含公开 Ingest 地址和只写凭证。
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "已复制" : "复制配置"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm leading-6" tabIndex={0}>
        <code>{snippet}</code>
      </pre>
      {!dsn ? (
        <p className="text-sm text-muted-foreground">
          创建客户端 DSN 后会自动生成可复制的初始化代码。
        </p>
      ) : null}
    </div>
  );
}
