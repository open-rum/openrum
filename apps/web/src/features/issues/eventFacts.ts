import type { EventDetail } from "@/lib/api/issues";

/** Every safe field captured on the event. */
export function eventFacts(event: EventDetail): [string, string][] {
  return compact([
    ["页面 URL", event.pageUrl],
    ["路由", event.route],
    ["环境", event.environment],
    ["版本", event.release],
    ["Dist", event.dist],
    ["浏览器", join(event.browser, event.browserVersion)],
    ["系统", join(event.os, event.osVersion)],
    ["设备", event.deviceType],
    ["国家 / 地区", event.country],
    ["捕获机制", event.errorMechanism],
    ["会话", event.sessionId],
    ["匿名访客", event.visitorId],
    ["事件 ID", event.eventId],
    ["发生时间", new Date(event.timestamp).toLocaleString("zh-CN")],
    ["接收时间", new Date(event.receivedAt).toLocaleString("zh-CN")],
  ]);
}

function compact(entries: [string, string | undefined][]) {
  return entries.filter((entry): entry is [string, string] => Boolean(entry[1]));
}
function join(first?: string, second?: string) {
  return [first, second].filter(Boolean).join(" ");
}
