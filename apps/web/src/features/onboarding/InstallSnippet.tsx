import { useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type InstallSnippetProps = {
  writeKey: string | null;
  environment: string;
};

export function InstallSnippet({ writeKey, environment }: InstallSnippetProps) {
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(
    () => `import { init } from "@openrum/browser-sdk";

init({
  writeKey: "${writeKey ?? "<YOUR_WRITE_KEY>"}",
  endpoint: "${window.location.origin}/ingest/v1/envelope",
  environment: "${environment}",
});`,
    [environment, writeKey],
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
            在应用入口执行一次；endpoint 必须指向公开的 Ingest 地址。
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
      {!writeKey ? (
        <p className="text-sm text-muted-foreground">
          完整 Write Key 只显示一次。若未保存，请在上方创建新的接入 Key。
        </p>
      ) : null}
    </div>
  );
}
