import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parseIssueFilters, serializeIssueFilters, type IssueFilters } from "@/lib/api/issues";
import { equalsTerm, foldIntoQuery, textTerm } from "@/lib/search/legacy";

/**
 * The Issue filters in the URL. With `foldIntoQuery`, the list page reads the old one-field
 * parameters (release=, browser=, …) as conditions of its search and writes them back only as
 * `q`, because its search box shows every condition as text. The detail page keeps them as
 * they are: its tag preview narrows by them one value at a time.
 */
export function useIssueFilters(projectId: string, options: { foldIntoQuery?: boolean } = {}) {
  const initialNow = useMemo(() => new Date(), []);
  const href = useSyncExternalStore(subscribe, currentURL, currentURL);
  const fold = options.foldIntoQuery ?? false;
  const filters = useMemo(() => {
    const parsed = parseIssueFilters(projectId, new URL(href).searchParams, initialNow);
    return fold ? foldIssueFilters(parsed) : parsed;
  }, [href, initialNow, projectId, fold]);
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

/** What the list searches when a link names no search: the Issues that still need handling. */
export const DEFAULT_ISSUE_QUERY = "is:unresolved";

/**
 * Moves the one-field filters into the search query, including the workflow ones (status=,
 * assignee=, new=) that are now is: and assigned: conditions. A link with no search and none
 * of those opens on DEFAULT_ISSUE_QUERY; a cleared search (`q=`) stays cleared.
 */
export function foldIssueFilters(filters: IssueFilters): IssueFilters {
  const workflow = [
    filters.status ? `is:${filters.status}` : undefined,
    filters.assignee === "none"
      ? "is:unassigned"
      : filters.assignee
        ? equalsTerm("assigned", filters.assignee)
        : undefined,
    filters.newOnly ? "is:new" : undefined,
  ];
  const base = filters.q === undefined && !workflow.some(Boolean) ? DEFAULT_ISSUE_QUERY : filters.q;
  const folded = foldIntoQuery(base, [
    ...workflow,
    filters.title ? textTerm(filters.title) : undefined,
    filters.errorType ? equalsTerm("error.type", filters.errorType) : undefined,
    filters.fingerprint ? equalsTerm("fingerprint", filters.fingerprint) : undefined,
    filters.userId ? equalsTerm("user.id", filters.userId) : undefined,
    filters.release ? equalsTerm("release", filters.release) : undefined,
    filters.browser ? equalsTerm("browser", filters.browser) : undefined,
    filters.deviceType ? equalsTerm("device", filters.deviceType) : undefined,
    filters.country ? equalsTerm("country", filters.country) : undefined,
    filters.route ? equalsTerm("route", filters.route) : undefined,
  ]);
  return {
    ...filters,
    // foldIntoQuery reads an empty result as no search; here it is a cleared one.
    q: folded ?? (base === undefined ? undefined : ""),
    status: undefined,
    assignee: undefined,
    newOnly: undefined,
    title: undefined,
    errorType: undefined,
    fingerprint: undefined,
    userId: undefined,
    release: undefined,
    browser: undefined,
    deviceType: undefined,
    country: undefined,
    route: undefined,
  };
}
