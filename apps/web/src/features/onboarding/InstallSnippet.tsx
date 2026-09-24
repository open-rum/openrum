import { useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { OPENRUM_BROWSER_SDK_PATH } from "@openrum/protocol/dsn";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SDKPlatform } from "@/lib/api/projects";
import { getProjectPlatform } from "@/features/projects/projectPlatforms";

type InstallSnippetProps = {
  dsn: string | null;
  environment: string;
  platform: SDKPlatform;
};

const platformPlacement: Record<SDKPlatform, string> = {
  javascript: "应用入口文件",
  react: "src/main.tsx（createRoot 之前）",
  vue: "src/main.ts（createApp 之前）",
  nextjs: "客户端组件 app/openrum.tsx",
  nuxt: "plugins/openrum.client.ts",
  angular: "src/main.ts（bootstrapApplication 之前）",
  svelte: "src/main.ts（SvelteKit 使用 src/hooks.client.ts）",
};

function integrationSnippet(platform: SDKPlatform, dsn: string | null, environment: string) {
  const configuration = `init({
  dsn: "${dsn ?? "<YOUR_DSN>"}",
  environment: "${environment}",
});`;
  if (platform === "nextjs") {
    return `"use client";

import { useEffect } from "react";
import { init } from "@openrum/browser";

export function OpenRUM() {
  useEffect(() => {
    ${configuration.replaceAll("\n", "\n    ")}
  }, []);

  return null;
}`;
  }
  if (platform === "nuxt") {
    return `import { init } from "@openrum/browser";

export default defineNuxtPlugin(() => {
  ${configuration.replaceAll("\n", "\n  ")}
});`;
  }
  return `import { init } from "@openrum/browser";

${configuration}`;
}

type CDNLoadMode = "sync" | "async";

function cdnSnippet(dsn: string | null, environment: string, loadMode: CDNLoadMode) {
  let source = `<YOUR_OPENRUM_INSTANCE>${OPENRUM_BROWSER_SDK_PATH}`;
  if (dsn) {
    try {
      source = new URL(OPENRUM_BROWSER_SDK_PATH, new URL(dsn).origin).toString();
    } catch {
      // A malformed legacy value should keep the snippet usable as a template.
    }
  }
  if (loadMode === "async") {
    return `<script>
  (function () {
    var script = document.createElement("script");
    script.src = "${source}";
    script.async = true;
    script.onload = function () {
      OpenRUM.init({
        dsn: "${dsn ?? "<YOUR_DSN>"}",
        environment: "${environment}"
      });
    };
    document.head.appendChild(script);
  })();
</script>`;
  }

  return `<script src="${source}"></script>
<script>
  OpenRUM.init({
    dsn: "${dsn ?? "<YOUR_DSN>"}",
    environment: "${environment}"
  });
</script>`;
}

type InstallMethod = "package" | "cdn-sync" | "cdn-async";

export function InstallSnippet({ dsn, environment, platform }: InstallSnippetProps) {
  const [copied, setCopied] = useState<InstallMethod | null>(null);
  const [cdnLoadMode, setCDNLoadMode] = useState<CDNLoadMode>("async");
  const definition = getProjectPlatform(platform);
  const packageSnippet = useMemo(
    () => integrationSnippet(platform, dsn, environment),
    [dsn, environment, platform],
  );
  const browserSnippet = useMemo(
    () => cdnSnippet(dsn, environment, cdnLoadMode),
    [cdnLoadMode, dsn, environment],
  );

  async function copy(method: InstallMethod, snippet: string) {
    await navigator.clipboard.writeText(snippet);
    setCopied(method);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <Tabs defaultValue="package" className="gap-4">
      <TabsList aria-label="SDK 安装方式">
        <TabsTrigger value="package">包管理器</TabsTrigger>
        <TabsTrigger value="cdn">CDN 脚本</TabsTrigger>
      </TabsList>
      <TabsContent value="package" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">安装并初始化 {definition.label} SDK</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              运行 <code>pnpm add @openrum/browser</code>，再把配置放入
              {platformPlacement[platform]}。DSN 已包含公开 Ingest 地址和只写凭证。
            </p>
          </div>
          <CopyButton
            copied={copied === "package"}
            onClick={() => void copy("package", packageSnippet)}
          />
        </div>
        <Snippet value={packageSnippet} />
      </TabsContent>
      <TabsContent value="cdn" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">通过 Instance CDN 接入</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              无需 npm 或打包器。版本化脚本由当前 OpenRUM Instance 提供，可直接放入 HTML。
            </p>
          </div>
          <CopyButton
            copied={copied === `cdn-${cdnLoadMode}`}
            onClick={() => void copy(`cdn-${cdnLoadMode}`, browserSnippet)}
          />
        </div>
        <Tabs
          value={cdnLoadMode}
          onValueChange={(value) => setCDNLoadMode(value as CDNLoadMode)}
          className="gap-3"
        >
          <TabsList aria-label="CDN 加载方式">
            <TabsTrigger value="async">异步加载（推荐）</TabsTrigger>
            <TabsTrigger value="sync">同步加载</TabsTrigger>
          </TabsList>
          <TabsContent value="async" className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              不阻塞页面解析；SDK 加载完成后自动初始化。极早发生的事件可能无法采集。
            </p>
            <Snippet value={browserSnippet} />
          </TabsContent>
          <TabsContent value="sync" className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              按顺序加载并立即初始化，可尽早采集事件，但会等待脚本下载完成后继续解析页面。
            </p>
            <Snippet value={browserSnippet} />
          </TabsContent>
        </Tabs>
      </TabsContent>
      {!dsn ? (
        <p className="text-sm text-muted-foreground">
          创建客户端 DSN 后会自动生成可复制的初始化代码。
        </p>
      ) : null}
    </Tabs>
  );
}

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onClick}>
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      {copied ? "已复制" : "复制配置"}
    </Button>
  );
}

function Snippet({ value }: { value: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm leading-6" tabIndex={0}>
      <code>{value}</code>
    </pre>
  );
}
