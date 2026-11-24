import { useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { OPENRUM_BROWSER_SDK_PATH } from "@openrum/protocol/dsn";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SDKPlatform } from "@/lib/api/projects";
import { SnippetCode } from "./SnippetCode";

type InstallSnippetProps = {
  dsn: string | null;
  environment: string;
  platform: SDKPlatform;
};

const platformPlacement: Record<SDKPlatform, { file: string; instruction: string }> = {
  javascript: { file: "应用入口文件", instruction: "在应用启动前初始化。" },
  react: { file: "src/main.tsx", instruction: "在 createRoot 之前初始化。" },
  vue: { file: "src/main.ts", instruction: "在 createApp 之前初始化。" },
  nextjs: { file: "app/openrum.tsx", instruction: "创建客户端组件，并在根布局中引入。" },
  nuxt: { file: "plugins/openrum.client.ts", instruction: "创建客户端插件，由 Nuxt 自动加载。" },
  angular: { file: "src/main.ts", instruction: "在 bootstrapApplication 之前初始化。" },
  svelte: {
    file: "src/main.ts",
    instruction: "在应用启动前初始化；SvelteKit 使用 src/hooks.client.ts。",
  },
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

type InstallMethod = "install" | "package" | "cdn-sync" | "cdn-async";
const installCommand = "pnpm add @openrum/browser";

export function InstallSnippet({ dsn, environment, platform }: InstallSnippetProps) {
  const [copied, setCopied] = useState<InstallMethod | null>(null);
  const [cdnLoadMode, setCDNLoadMode] = useState<CDNLoadMode>("async");
  const placement = platformPlacement[platform];
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
    <Tabs defaultValue="package" className="gap-6">
      <TabsList aria-label="SDK 安装方式">
        <TabsTrigger value="package">包管理器</TabsTrigger>
        <TabsTrigger value="cdn">CDN 脚本</TabsTrigger>
      </TabsList>
      <TabsContent value="package" className="flex flex-col gap-6">
        <section className="space-y-3" aria-label="安装 SDK">
          <h3 className="text-sm font-medium">1. 安装 SDK</h3>
          <Snippet
            value={installCommand}
            label="终端"
            copyLabel="复制命令"
            copied={copied === "install"}
            onCopy={() => void copy("install", installCommand)}
          />
        </section>
        <section className="space-y-3" aria-label="初始化 SDK">
          <div>
            <h3 className="text-sm font-medium">2. 初始化 SDK</h3>
            <p className="mt-1 text-sm text-base-content/70">{placement.instruction}</p>
          </div>
          <Snippet
            value={packageSnippet}
            label={placement.file}
            copyLabel="复制配置"
            copied={copied === "package"}
            onCopy={() => void copy("package", packageSnippet)}
          />
        </section>
      </TabsContent>
      <TabsContent value="cdn" className="flex flex-col gap-4">
        <p className="text-sm text-base-content/70">将以下代码添加到 HTML 中，无需安装依赖。</p>
        <Tabs
          value={cdnLoadMode}
          onValueChange={(value) => setCDNLoadMode(value as CDNLoadMode)}
          className="gap-4"
        >
          <TabsList aria-label="CDN 加载方式">
            <TabsTrigger value="async">异步加载（推荐）</TabsTrigger>
            <TabsTrigger value="sync">同步加载</TabsTrigger>
          </TabsList>
          <TabsContent value="async" className="flex flex-col gap-3">
            <p className="text-sm text-base-content/70">
              不阻塞页面加载；SDK 加载完成前的事件可能无法采集。
            </p>
            <Snippet
              value={browserSnippet}
              label="HTML"
              copyLabel="复制配置"
              copied={copied === "cdn-async"}
              onCopy={() => void copy("cdn-async", browserSnippet)}
            />
          </TabsContent>
          <TabsContent value="sync" className="flex flex-col gap-3">
            <p className="text-sm text-base-content/70">
              先加载 SDK，再执行后续脚本；页面会等待脚本下载完成。
            </p>
            <Snippet
              value={browserSnippet}
              label="HTML"
              copyLabel="复制配置"
              copied={copied === "cdn-sync"}
              onCopy={() => void copy("cdn-sync", browserSnippet)}
            />
          </TabsContent>
        </Tabs>
      </TabsContent>
    </Tabs>
  );
}

function Snippet({
  value,
  label,
  copyLabel,
  copied,
  onCopy,
}: {
  value: string;
  label: string;
  copyLabel: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-box border border-base-300 bg-base-200">
      <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-2">
        <span className="min-w-0 break-all font-mono text-xs text-base-content/70">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCopy}
          aria-label={copied ? "已复制" : copyLabel}
          title={copied ? "已复制" : copyLabel}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
        <span className="sr-only" role="status">
          {copied ? `${copyLabel}成功` : ""}
        </span>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-6" tabIndex={0} aria-label={label}>
        <SnippetCode value={value} command={label === "终端"} />
      </pre>
    </div>
  );
}
