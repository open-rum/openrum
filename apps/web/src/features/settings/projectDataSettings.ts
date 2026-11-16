// One route-backed group: keep existing deep links while presenting a single sidebar entry.
export const projectDataSettings = [
  {
    key: "sampling",
    path: "/settings/project/$projectId/sampling",
    label: "采样配置",
  },
  {
    key: "quota",
    path: "/settings/project/$projectId/quota",
    label: "速率限制",
  },
  {
    key: "filters",
    path: "/settings/project/$projectId/filters",
    label: "入站过滤",
  },
  {
    key: "api-capture",
    path: "/settings/project/$projectId/api-capture",
    label: "API 采集",
  },
  {
    key: "url-rules",
    path: "/settings/project/$projectId/url-rules",
    label: "URL 归一化",
  },
  {
    key: "scrubbing",
    path: "/settings/project/$projectId/scrubbing",
    label: "隐私脱敏",
  },
] as const;

export type ProjectDataSection = (typeof projectDataSettings)[number]["key"];
