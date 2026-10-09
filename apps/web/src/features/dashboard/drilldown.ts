import { serializeOverviewFilters, type OverviewFilters } from "@/lib/filters/schema";

// A ranked row links onward only where the destination page actually reads the value from
// its URL. Release and route are shared filters every investigation page honours; the API
// page also reads method and url. Other dimensions get no link rather than one that opens
// an unfiltered page and looks like it worked.
export function drilldownURL(
  metricId: string,
  dimension: string,
  value: string,
  filters: OverviewFilters,
): string | undefined {
  if (value === "unknown" || value === "other") return undefined;
  const family = metricId.split(".")[0];
  const page =
    family === "api"
      ? "apis"
      : family === "vitals"
        ? "performance"
        : family === "issues" || metricId === "traffic.errors" || metricId === "traffic.errorRate"
          ? "issues"
          : undefined;
  if (!page) return undefined;
  const base = { ...filters, cursor: undefined, release: filters.release, route: filters.route };
  if (dimension === "release" || dimension === "route") {
    const parameters = serializeOverviewFilters({ ...base, [dimension]: value });
    return `/projects/${encodeURIComponent(filters.projectId)}/${page}?${parameters.toString()}`;
  }
  if (dimension === "api" && page === "apis") {
    const space = value.indexOf(" ");
    if (space <= 0) return undefined;
    const parameters = serializeOverviewFilters(base);
    parameters.set("method", value.slice(0, space));
    parameters.set("url", value.slice(space + 1));
    return `/apis?${parameters.toString()}`;
  }
  return undefined;
}
