export type TrendPoint = {
  time: string;
  pv: number;
  uv: number;
  errorRate: number;
};

export const trendData: TrendPoint[] = [
  { time: "00:00", pv: 310, uv: 185, errorRate: 0.42 },
  { time: "02:00", pv: 260, uv: 156, errorRate: 0.36 },
  { time: "04:00", pv: 235, uv: 142, errorRate: 0.31 },
  { time: "06:00", pv: 305, uv: 174, errorRate: 0.43 },
  { time: "08:00", pv: 510, uv: 245, errorRate: 0.52 },
  { time: "10:00", pv: 595, uv: 284, errorRate: 0.48 },
  { time: "12:00", pv: 624, uv: 301, errorRate: 0.56 },
  { time: "14:00", pv: 612, uv: 294, errorRate: 0.62 },
  { time: "14:20", pv: 653, uv: 175, errorRate: 2.31 },
  { time: "16:00", pv: 501, uv: 268, errorRate: 0.72 },
  { time: "18:00", pv: 472, uv: 256, errorRate: 0.57 },
  { time: "20:00", pv: 481, uv: 263, errorRate: 0.51 },
  { time: "22:00", pv: 411, uv: 221, errorRate: 0.46 },
  { time: "24:00", pv: 302, uv: 181, errorRate: 0.41 },
];

type Kpi = {
  label: string;
  suffix?: string;
  value: string;
  delta: string;
  tone: "good" | "bad" | "neutral";
};

export const kpis: Kpi[] = [
  { label: "PV", value: "12.8M", delta: "4.2%", tone: "good" },
  { label: "UV", value: "3.42M", delta: "1.8%", tone: "good" },
  { label: "错误率", value: "0.84%", delta: "0.19pp", tone: "bad" },
  { label: "受影响用户", value: "28,406", delta: "12.6%", tone: "bad" },
  { label: "LCP", suffix: "p75", value: "2.1s", delta: "0%", tone: "neutral" },
  { label: "INP", suffix: "p75", value: "168ms", delta: "4.5%", tone: "bad" },
];

export const attentionItems = [
  {
    title: "错误率 TypeError 激增",
    detail: "错误率 2.31%（较昨日 +1.87pp）",
    meta: "影响用户 12,932　事件数 18,406",
    severity: "严重",
  },
  {
    title: "/api/order 接口 p95 响应时间回归",
    detail: "p95 1.82s（较昨日 +632ms）",
    meta: "影响用户 9,104　请求量 237,542",
    severity: "高",
  },
  {
    title: "Android Chrome 上 LCP 变差",
    detail: "LCP 2.78s（较昨日 +0.62s）",
    meta: "影响用户 21,867　页面占比 31.4%",
    severity: "中",
  },
];

export const countries = [
  { name: "中国", code: "CN", pv: "7.99M", share: "62.4%" },
  { name: "美国", code: "US", pv: "1.90M", share: "14.8%" },
  { name: "日本", code: "JP", pv: "0.97M", share: "7.6%" },
  { name: "新加坡", code: "SG", pv: "0.67M", share: "5.2%" },
  { name: "德国", code: "DE", pv: "0.40M", share: "3.1%" },
];

export const devices = [
  { name: "iOS", value: "4.86M", share: "38%" },
  { name: "Android", value: "4.22M", share: "33%" },
  { name: "Desktop", value: "3.45M", share: "27%" },
];

export const browsers = [
  { name: "Chrome", value: "7.42M", share: "58%" },
  { name: "Safari", value: "3.71M", share: "29%" },
  { name: "Edge", value: "0.90M", share: "7%" },
  { name: "Firefox", value: "0.51M", share: "4%" },
];

export const issues = [
  {
    title: "TypeError: Cannot read property 'price' of undefined",
    path: "/checkout/index.vue:128:19",
    type: "错误",
    users: "12,932",
    share: "8.41%",
    events: "18,406",
    time: "13:58",
    trend: [2, 4, 3, 8, 5, 9, 6],
  },
  {
    title: "ChunkLoadError: Loading chunk 23 failed",
    path: "/static/js/23.8f3c2e.js",
    type: "资源",
    users: "6,131",
    share: "3.98%",
    events: "7,842",
    time: "14:05",
    trend: [2, 5, 4, 7, 8, 6, 9],
  },
  {
    title: "TypeError: e.detail is undefined",
    path: "/components/coupon/useCoupon.ts:56:22",
    type: "错误",
    users: "4,672",
    share: "3.04%",
    events: "5,381",
    time: "14:02",
    trend: [3, 2, 5, 4, 6, 8, 7],
  },
  {
    title: "Failed to fetch",
    path: "/api/order/submit",
    type: "网络",
    users: "3,201",
    share: "2.08%",
    events: "3,912",
    time: "13:56",
    trend: [1, 3, 2, 6, 4, 7, 5],
  },
  {
    title: "ResizeObserver loop limit exceeded",
    path: "unknown",
    type: "性能",
    users: "1,843",
    share: "1.20%",
    events: "2,184",
    time: "13:49",
    trend: [2, 2, 3, 4, 3, 6, 5],
  },
];

export const apis = [
  {
    method: "POST",
    path: "/api/order/submit",
    requests: "237,542",
    errorRate: "1.34%",
    p95: "1.82s",
    tone: "bad",
    trend: [2, 4, 3, 7, 5, 9, 6],
  },
  {
    method: "GET",
    path: "/api/product/list",
    requests: "1,284,911",
    errorRate: "0.21%",
    p95: "1.12s",
    tone: "warn",
    trend: [2, 3, 5, 4, 6, 5, 7],
  },
  {
    method: "GET",
    path: "/api/search",
    requests: "953,121",
    errorRate: "0.18%",
    p95: "987ms",
    tone: "warn",
    trend: [1, 4, 2, 5, 4, 7, 6],
  },
  {
    method: "POST",
    path: "/api/cart/update",
    requests: "612,483",
    errorRate: "0.47%",
    p95: "876ms",
    tone: "warn",
    trend: [3, 2, 5, 6, 4, 7, 5],
  },
  {
    method: "GET",
    path: "/api/user/info",
    requests: "1,072,664",
    errorRate: "0.12%",
    p95: "642ms",
    tone: "good",
    trend: [5, 4, 6, 3, 4, 2, 3],
  },
];

export const customBreakdown = [
  { channel: "organic", success: "97.8%", duration: "1.18s" },
  { channel: "ads", success: "95.4%", duration: "1.66s" },
  { channel: "affiliate", success: "94.1%", duration: "1.98s" },
];
