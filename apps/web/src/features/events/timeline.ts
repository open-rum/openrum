export type BehaviorTimelineItem = {
  category: "navigation" | "click" | "custom" | "other";
  title: string;
  description: string;
  timestamp?: string;
  metadata: Array<[string, string]>;
};

export function sessionTimelineRange(timestamp: string) {
  const anchor = new Date(timestamp).getTime();
  const halfWindow = 12 * 60 * 60 * 1000;
  return {
    from: new Date(anchor - halfWindow),
    to: new Date(anchor + halfWindow),
  };
}

export function parseBehaviorTimelineItem(raw: string): BehaviorTimelineItem {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const rawCategory = typeof value.category === "string" ? value.category : "other";
    const message = typeof value.message === "string" ? value.message : "用户行为";
    const metadata = parseMetadata(value.data);
    const category = normalizeCategory(rawCategory);
    return {
      category,
      title: titleFor(category),
      description: descriptionFor(category, message, metadata),
      timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
      metadata,
    };
  } catch {
    return {
      category: "other",
      title: "用户行为",
      description: raw,
      metadata: [],
    };
  }
}

function parseMetadata(input: unknown): Array<[string, string]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.entries(input)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .slice(0, 6);
}

function normalizeCategory(value: string): BehaviorTimelineItem["category"] {
  if (value === "navigation") return "navigation";
  if (value === "ui.click") return "click";
  if (value === "custom") return "custom";
  return "other";
}

function titleFor(category: BehaviorTimelineItem["category"]) {
  if (category === "navigation") return "页面导航";
  if (category === "click") return "元素点击";
  if (category === "custom") return "自定义事件";
  return "用户行为";
}

function descriptionFor(
  category: BehaviorTimelineItem["category"],
  message: string,
  metadata: Array<[string, string]>,
) {
  const data = Object.fromEntries(metadata);
  if (category === "navigation") {
    const action =
      message === "route_change"
        ? "切换前端路由"
        : message === "back_forward"
          ? "通过前进或后退打开页面"
          : message === "reload"
            ? "重新加载页面"
            : "打开页面";
    return data.route ? `${action}：${data.route}` : action;
  }
  if (category === "click") {
    return data.name ? `点击 ${data.name}` : `点击 ${data.element || "交互元素"}`;
  }
  return message;
}
