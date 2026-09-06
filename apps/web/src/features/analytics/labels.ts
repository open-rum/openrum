export function eventLabel(kind: string, name: string) {
  if (name !== kind) return name;
  return (
    {
      page_view: "页面访问",
      navigation: "页面导航",
      click: "元素点击",
      custom: "自定义事件",
    }[kind] ?? name
  );
}
