import { countryNumericCodes } from "./countryCodes";
import { countryLabel } from "@/features/filters/dimensionLabels";

export type CountryValue = { code: string; value: number };

export function countryMapID(code: string): string | undefined {
  const normalized = code.trim().toUpperCase();
  return normalized === "XK" ? "XK" : countryNumericCodes[normalized];
}

export function countryMapLabel(code: string): string {
  const normalized = code.trim().toUpperCase();
  return normalized ? countryLabel(normalized) : "未知国家";
}

// Do not aggregate approximate distinct users/sessions across aliases or regions.
// The API returns one group per ISO alpha-2 country; nonstandard values stay in details.
export function mapCountryValues(data: CountryValue[], available: ReadonlySet<string>) {
  const mapped = new Map<string, CountryValue>();
  const unmapped: CountryValue[] = [];
  for (const entry of data) {
    const id = countryMapID(entry.code);
    if (id && available.has(id) && !mapped.has(id)) mapped.set(id, entry);
    else unmapped.push(entry);
  }
  return { mapped, unmapped };
}

export function countryFill(value: number | undefined, maximum: number): string {
  if (value === undefined) return "var(--ds-surface-subtle)";
  const intensity = maximum > 0 ? Math.max(0, Math.min(1, value / maximum)) : 0;
  return `color-mix(in srgb, var(--ds-chart-1) ${20 + intensity * 80}%, var(--ds-surface))`;
}
