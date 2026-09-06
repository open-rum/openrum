export const rejectGuidance: Record<string, { title: string; action: string }> = {
  ORIGIN_REJECTED: {
    title: "上报 Origin 未被允许",
    action:
      "将浏览器地址栏中的 Origin 加入项目 Allowed Origins，保存后刷新已接入页面。不要填写路径或结尾斜杠。",
  },
  RATE_LIMITED: {
    title: "上报触发限流",
    action:
      "等待 Retry-After 指定时间；若持续发生，请降低 SDK 采样率或检查同一页面是否重复初始化。",
  },
  INGEST_UNAVAILABLE: {
    title: "事件队列暂不可用",
    action:
      "检查 Kafka 与 Ingest ready 状态，恢复后点击“发送测试事件”。服务端不会把未入队事件标记为成功。",
  },
  ENVIRONMENT_MISMATCH: {
    title: "环境配置不一致",
    action: "确保 SDK environment 与项目环境完全一致，然后重新打开页面。",
  },
  INVALID_EVENT: {
    title: "事件格式不受支持",
    action: "升级到当前 Browser SDK，并检查自定义事件名称和属性是否满足长度限制。",
  },
};
