export const palettes = [
  {
    id: "citrus",
    name: "Citrus",
    label: "唯一主题",
    description: "明亮青柠绿、中性灰与蓝绿色辅助色，统一官网、文档和控制台。",
  },
] as const;
export type Palette = (typeof palettes)[number]["id"];
export const defaultPalette: Palette = "citrus";
export const isPalette = (value: unknown): value is Palette =>
  palettes.some((item) => item.id === value);

export const colorGroups = [
  {
    title: "品牌与强调",
    description: "Logo 与主系列保持柠檬绿；普通文字、导航和控件使用中性色。",
    tokens: [
      ["--ds-logo", "Logo", "所有模式的品牌标记"],
      ["--ds-primary", "Primary", "主题强调与小面积高亮，配黑色文字"],
      ["--ds-selection", "Selection", "表单选中面的浅柠檬绿背景"],
      ["--ds-selection-border", "Selection border", "选中控件边界与状态线"],
      ["--ds-brand", "Link ink", "中性文字色，正文链接用下划线区分"],
      ["--ds-secondary", "Secondary", "蓝绿色辅助系列"],
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
      ["--ds-sidebar-accent", "Navigation", "导航选中背景，配中性文字"],
      ["--ds-input", "Input", "输入框边界"],
      ["--ds-ring", "Focus", "键盘焦点"],
    ],
  },
  {
    title: "文字与状态",
    description: "状态颜色配合文字或图标使用，不依靠颜色单独传达含义。",
    tokens: [
      ["--ds-text", "Primary text", "标题与主要内容"],
      ["--ds-text-secondary", "Secondary text", "字段标签、图例、表格辅助列"],
      ["--ds-text-muted", "Muted text", "辅助说明"],
      ["--ds-success", "Success", "正常与成功"],
      ["--ds-warning", "Warning", "需留意"],
      ["--ds-danger", "Error", "错误与失败"],
      ["--ds-info", "Info", "信息提示"],
      ["--ds-chart-success", "Good chart", "达标评分柱、仪表盘填充"],
      ["--ds-chart-warning", "Warning chart", "待优化评分柱、仪表盘填充"],
    ],
  },
  {
    title: "数据分类色",
    description: "固定顺序的十色分类色板；同一图表按顺序取色，超过十类时合并低频项为其他。",
    tokens: [
      ["--ds-chart-1", "Lemon", "品牌主系列与第一分类"],
      ["--ds-chart-2", "Blue", "第二分类"],
      ["--ds-chart-3", "Orange", "第三分类"],
      ["--ds-chart-4", "Violet", "第四分类"],
      ["--ds-chart-5", "Teal", "第五分类"],
      ["--ds-chart-6", "Coral", "第六分类"],
      ["--ds-chart-7", "Cyan", "第七分类"],
      ["--ds-chart-8", "Magenta", "第八分类"],
      ["--ds-chart-9", "Gold", "第九分类"],
      ["--ds-chart-10", "Slate", "第十分类或其他"],
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
    detail: "辅助信息 · 12 · 500",
  },
] as const;
