import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parseIssueFilters, serializeIssueFilters, type IssueFilters } from "@/lib/api/issues";

export function useIssueFilters(projectId: string) {
  const initialNow = useMemo(() => new Date(), []);
  const href = useSyncExternalStore(subscribe, currentURL, currentURL);
  const filters = useMemo(
    () => parseIssueFilters(projectId, new URL(href).searchParams, initialNow),
    [href, initialNow, projectId],
  );
  const update = useCallback(
    (patch: Partial<Omit<IssueFilters, "projectId">>, mode: "push" | "replace" = "push") => {
      const next = { ...filters, ...patch, projectId };
      const url = new URL(window.location.href);
      // The shared analysis context owns the relative time preset; keep it across filter edits.
      const timePreset = url.searchParams.get("timePreset");
      url.search = serializeIssueFilters(next).toString();
      if (timePreset) url.searchParams.set("timePreset", timePreset);
      window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
      window.dispatchEvent(new Event("openrum:urlchange"));
    },
    [filters, projectId],
  );
  return { filters, update };
}

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener("openrum:urlchange", listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("openrum:urlchange", listener);
  };
}
function currentURL() {
  return window.location.href;
}
