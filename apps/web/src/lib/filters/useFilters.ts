import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  overviewFiltersSchema,
  parseOverviewFilters,
  serializeOverviewFilters,
  type OverviewFilterPatch,
} from "./schema";

export function useFilters(projectId: string) {
  const initialNow = useMemo(() => new Date(), []);
  const href = useSyncExternalStore(subscribeToURL, currentURL, currentURL);
  const filters = useMemo(
    () => parseOverviewFilters(projectId, new URL(href).searchParams, initialNow),
    [href, initialNow, projectId],
  );

  useEffect(() => {
    const canonical = serializeOverviewFilters(filters);
    keepTimePreset(canonical, new URL(window.location.href).searchParams);
    replaceSearch(canonical);
  }, [filters]);

  const updateFilters = useCallback(
    (patch: OverviewFilterPatch, mode: "push" | "replace" = "push") => {
      const next = overviewFiltersSchema.parse({ ...filters, ...patch, projectId });
      const url = new URL(window.location.href);
      const search = serializeOverviewFilters(next);
      // A patch that moves the range makes it a fixed one; any other patch leaves the preset.
      if (patch.from === undefined && patch.to === undefined) {
        keepTimePreset(search, url.searchParams);
      }
      url.search = search.toString();
      window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
      window.dispatchEvent(new Event("openrum:urlchange"));
    },
    [filters, projectId],
  );

  return { filters, updateFilters };
}

function subscribeToURL(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("openrum:urlchange", onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("openrum:urlchange", onStoreChange);
  };
}

function currentURL() {
  return window.location.href;
}

/**
 * `timePreset` belongs to the shared analysis context (AnalysisContextBar), not to these
 * filters. Rewriting the query string without it would turn a rolling "最近 24 小时" into a
 * fixed range that is then saved as 自定义 and never rolls forward again.
 */
function keepTimePreset(target: URLSearchParams, current: URLSearchParams) {
  const preset = current.get("timePreset");
  if (preset) target.set("timePreset", preset);
}

function replaceSearch(search: URLSearchParams) {
  const url = new URL(window.location.href);
  if (url.searchParams.toString() === search.toString()) return;
  url.search = search.toString();
  window.history.replaceState({}, "", url);
}
