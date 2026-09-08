export const palettes = [
  {
    id: "acid",
    name: "Acid Green",
    label: "文档原案",
    description: "酸橙绿、冷黑底色。来自 Landing Page Spec v1。",
  },
  {
    id: "citrus",
    name: "Citrus",
    label: "现有配色",
    description: "柠檬绿与中性灰，保留当前产品的视觉基础。",
  },
  {
    id: "graphite",
    name: "Graphite",
    label: "克制一些",
    description: "石墨灰与柔和鼠尾草绿，适合长时间阅读数据。",
  },
] as const;
export type Palette = (typeof palettes)[number]["id"];
export const defaultPalette: Palette = "acid";
export const isPalette = (value: unknown): value is Palette =>
  palettes.some((item) => item.id === value);

export const colorGroups = [
  {
    title: "品牌与强调",
    description: "大面积填充与小字号文字各有角色。亮色模式使用深色强调文字。",
    tokens: [
      ["--ds-primary", "Accent", "品牌填充、数据重点"],
      ["--ds-brand", "Brand ink", "链接、细线与图标"],
      ["--ds-brand-soft", "Brand subtle", "选中状态、轻背景"],
      ["--ds-action-contrast", "Action", "主要操作，随主题反转"],
    ],
  },
  {
    title: "背景与层次",
    description: "通过表面与边界建立层级，减少不必要的阴影。",
    tokens: [
      ["--ds-canvas", "Canvas", "页面底色"],
      ["--ds-surface", "Surface", "卡片与内容面板"],
      ["--ds-surface-subtle", "Subtle", "代码、嵌套区域"],
      ["--ds-border", "Border", "分割与边界"],
    ],
  },
  {
    title: "文字与状态",
    description: "状态颜色配合文字或图标使用，不依靠颜色单独传达含义。",
    tokens: [
      ["--ds-text", "Primary text", "标题与主要内容"],
      ["--ds-text-muted", "Muted text", "辅助说明"],
      ["--ds-success", "Success", "正常与成功"],
      ["--ds-warning", "Warning", "需留意"],
      ["--ds-danger", "Error", "错误与失败"],
      ["--ds-info", "Info", "信息提示"],
    ],
  },
] as const;

export const typeSamples = [
  {
    name: "Display",
    weight: 700,
    text: "Understand your users.",
    size: "--type-display",
    detail: "官网 · 56 / 38 · 700",
  },
  {
    name: "Heading",
    weight: 700,
    text: "看清全貌，理解用户体验。",
    size: "--type-heading",
    detail: "章节 · 40 / 30 · 700",
  },
  {
    name: "Title",
    weight: 600,
    text: "Find the source. Fix the issue.",
    size: "--text-title",
    detail: "面板标题 · 24 · 600",
  },
  {
    name: "Body",
    weight: 400,
    text: "Track errors, analyze user behavior, and monitor application performance.",
    size: "--type-body-marketing",
    detail: "官网正文 · 18 / 16 · 400",
  },
  {
    name: "Product",
    weight: 400,
    text: "项目概览　页面浏览　错误率　平均响应时间",
    size: "--text-body",
    detail: "产品正文 · 14 · 400",
  },
  {
    name: "Caption",
    weight: 500,
    text: "LAST UPDATED 2 MINUTES AGO · 最近更新",
    size: "--text-caption",
    detail: "辅助信息 · 11 · 500",
  },
] as const;
