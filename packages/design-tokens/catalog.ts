// The four-colour card. Amber is the brand; lime, sky and magenta are accents. A palette
// makes one of them primary and the rest accents, in the order listed in its `dots`.
export const cardHues = [
  { id: "amber", name: "Amber", label: "琥珀", token: "--ds-amber-solid" },
  { id: "lime", name: "Lime", label: "柠檬绿", token: "--ds-lime-solid" },
  { id: "sky", name: "Sky", label: "天蓝", token: "--ds-sky-solid" },
  { id: "magenta", name: "Magenta", label: "品红", token: "--ds-magenta-solid" },
] as const;
export type CardHue = (typeof cardHues)[number]["id"];

// Switchable palettes. To retire one, delete it here and its block in tokens.css; every
// switcher hides itself when only one palette is left.
export const palettes = [
  {
    id: "amber",
    name: "Amber",
    label: "琥珀",
    description: "默认品牌配色：琥珀为主色，柠檬绿、天蓝、品红点缀。",
    dots: ["amber", "lime", "sky", "magenta"],
  },
  {
    id: "lime",
    name: "Lime",
    label: "柠檬绿",
    description: "原 Citrus 配色：柠檬绿为主色，琥珀、天蓝、品红点缀。",
    dots: ["lime", "amber", "sky", "magenta"],
  },
  {
    id: "magenta",
    name: "Magenta",
    label: "品红",
    description: "品红为主色，琥珀、柠檬绿、天蓝点缀。",
    dots: ["magenta", "amber", "lime", "sky"],
  },
] as const satisfies ReadonlyArray<{
  id: CardHue;
  name: string;
  label: string;
  description: string;
  dots: readonly CardHue[];
}>;
export type Palette = (typeof palettes)[number]["id"];
export const defaultPalette: Palette = "amber";
export const isPalette = (value: unknown): value is Palette =>
  palettes.some((item) => item.id === value);
export const paletteStorageKey = "openrum-palette";

export const densities = [
  { id: "comfortable", label: "舒适", description: "默认：40px 控件、44px 表格行" },
  { id: "compact", label: "紧凑", description: "32px 控件、36px 表格行，文字不小于 12px" },
] as const;
export type Density = (typeof densities)[number]["id"];
export const defaultDensity: Density = "comfortable";
export const isDensity = (value: unknown): value is Density =>
  densities.some((item) => item.id === value);
export const densityStorageKey = "openrum-density";

export const colorGroups = [
  {
    title: "品牌与强调",
    description: "主色随配色切换；普通文字、导航和主要操作保持中性色。",
    tokens: [
      ["--ds-logo", "Logo", "品牌标记，随配色切换"],
      ["--ds-primary", "Primary", "当前主色：选中、焦点、开关、进度与第一数据系列"],
      ["--ds-primary-soft", "Primary soft", "选中面与品牌徽标底色"],
      ["--ds-primary-ink", "Primary ink", "浅底与画布上的品牌文字"],
      ["--ds-selection-border", "Selection border", "选中控件边界"],
      ["--ds-accent-1", "Accent 1", "第一点缀色，第二数据系列"],
      ["--ds-accent-2", "Accent 2", "第二点缀色，第三数据系列"],
      ["--ds-accent-3", "Accent 3", "第三点缀色，第四数据系列"],
      ["--ds-brand", "Link ink", "中性文字色，正文链接用下划线区分"],
      ["--ds-action-contrast", "Action", "主要操作，亮色黑底、暗色白底"],
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
    description: "状态颜色配合文字或图标使用，不依靠颜色单独传达含义；警告用橙色，与琥珀主色区分。",
    tokens: [
      ["--ds-text", "Primary text", "标题与主要内容"],
      ["--ds-text-secondary", "Secondary text", "字段标签、图例、表格辅助列"],
      ["--ds-text-muted", "Muted text", "辅助说明"],
      ["--ds-success", "Success", "正常与成功"],
      ["--ds-warning", "Warning", "需留意"],
      ["--ds-danger", "Error", "错误与失败"],
      ["--ds-info", "Info", "信息提示"],
    ],
  },
  {
    title: "数据分类色",
    description:
      "前四个系列跟随配色：主色、三个点缀色；后六个固定，并避开色卡色相。上一周期用中性灰虚线。",
    tokens: [
      ["--ds-chart-1", "Primary", "品牌主系列与第一分类"],
      ["--ds-chart-2", "Accent 1", "第二分类"],
      ["--ds-chart-3", "Accent 2", "第三分类"],
      ["--ds-chart-4", "Accent 3", "第四分类"],
      ["--ds-chart-5", "Violet", "第五分类"],
      ["--ds-chart-6", "Teal", "第六分类"],
      ["--ds-chart-7", "Coral", "第七分类"],
      ["--ds-chart-8", "Indigo", "第八分类"],
      ["--ds-chart-9", "Umber", "第九分类"],
      ["--ds-chart-10", "Slate", "第十分类或其他"],
      ["--ds-chart-comparison", "Previous", "上一周期，虚线"],
    ],
  },
] as const;

// Every hue of the card, with its roles, for the design workbench.
export const cardRoles = [
  ["solid", "实心填充"],
  ["soft", "浅色底"],
  ["ink", "可读文字"],
  ["border", "描边"],
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
