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
    replaceSearch(canonical);
  }, [filters]);

  const updateFilters = useCallback(
    (patch: OverviewFilterPatch, mode: "push" | "replace" = "push") => {
      const next = overviewFiltersSchema.parse({ ...filters, ...patch, projectId });
      const url = new URL(window.location.href);
      url.search = serializeOverviewFilters(next).toString();
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

function replaceSearch(search: URLSearchParams) {
  const url = new URL(window.location.href);
  if (url.searchParams.toString() === search.toString()) return;
  url.search = search.toString();
  window.history.replaceState({}, "", url);
}
