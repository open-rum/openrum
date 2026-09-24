// One route-backed group: keep existing deep links while presenting a single sidebar entry.
export const projectDataSettings = [
  {
    key: "sampling",
    path: "/settings/project/$projectId/sampling",
    label: "采样配置",
    description:
      "决定日常保留多少数据。在 SDK 上报前按会话采样，分别控制行为与性能、API 和错误事件。",
  },
  {
    key: "quota",
    path: "/settings/project/$projectId/quota",
    label: "速率限制",
    description:
      "保护服务端的接收能力：限制项目每秒的上报请求数，并选择超限处理策略。这与 SDK 的日常采样独立。",
  },
  {
    key: "filters",
    path: "/settings/project/$projectId/filters",
    label: "入站过滤",
    description:
      "排除不需要的数据，例如爬虫、浏览器扩展和本地调试流量。规则由 Consumer 执行，SDK 会提前过滤其中一部分以节省带宽。",
  },
  {
    key: "url-rules",
    path: "/settings/project/$projectId/url-rules",
    label: "URL 归一化",
    description:
      "把不同地址归为同一条路由，例如将订单详情统一为 /orders/:orderId。内置规则已识别常见 ID，这里补充自定义路径。",
  },
  {
    key: "scrubbing",
    path: "/settings/project/$projectId/scrubbing",
    label: "隐私脱敏",
    description:
      "在数据入库前隐藏敏感内容。内置的邮箱、Bearer、JWT、信用卡和敏感字段保护始终生效，这里追加项目规则。",
  },
] as const;

export type ProjectDataSection = (typeof projectDataSettings)[number]["key"];
