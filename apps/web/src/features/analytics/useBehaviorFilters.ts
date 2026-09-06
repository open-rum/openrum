import { useMemo, useSyncExternalStore } from "react";
import {
  defaultBehaviorFilters,
  serializeBehaviorFilters,
  type BehaviorFilters,
} from "@/lib/api/analytics";

export function useBehaviorFilters(projectId: string) {
  const search = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => "",
  );
  const filters = useMemo(
    () => defaultBehaviorFilters(projectId, new URLSearchParams(search)),
    [projectId, search],
  );
  const update = (patch: Partial<BehaviorFilters>, mode: "push" | "replace" = "push") => {
    const parameters = serializeBehaviorFilters({ ...filters, ...patch });
    window.history[mode === "push" ? "pushState" : "replaceState"](
      {},
      "",
      `${window.location.pathname}?${parameters}`,
    );
    window.dispatchEvent(new Event("openrum:urlchange"));
  };
  return { filters, update };
}

function subscribeLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("openrum:urlchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("openrum:urlchange", callback);
  };
}
