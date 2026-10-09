import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";

/** Issue dimensions a tag value can narrow the investigation to. */
export type TagFilterKey = "release" | "browser" | "deviceType" | "country";

export const tagFilterTitles: Record<TagFilterKey, string> = {
  release: "版本",
  browser: "浏览器",
  deviceType: "设备",
  country: "国家 / 地区",
};

export function tagValueLabel(key: TagFilterKey | null, value: string) {
  if (!value) return "未知";
  if (key === "country") return countryLabel(value);
  if (key === "deviceType") return deviceLabel(value);
  return value;
}
