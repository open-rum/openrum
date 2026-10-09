const countries = new Intl.DisplayNames(["zh-CN"], { type: "region" });
export function countryLabel(value: string) {
  if (!/^[A-Z]{2}$/.test(value)) return value;
  return value === "ZZ" ? "未知国家 (ZZ)" : `${countries.of(value) ?? value} (${value})`;
}
/** A country group: case-insensitive codes, with blank and "unknown" read as unknown. */
export function countryGroupLabel(value: string) {
  const code = value.trim().toUpperCase();
  return code && code !== "UNKNOWN" ? countryLabel(code) : "未知国家";
}
export function deviceLabel(value: string) {
  return (
    (
      {
        desktop: "电脑 / PC",
        mobile: "手机 / Mobile",
        tablet: "平板 / Tablet",
        unknown: "未知设备",
      } as Record<string, string>
    )[value] ?? value
  );
}
