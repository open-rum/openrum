import { equalsTerm } from "@/lib/search/legacy";

type Range = { from: string; to: string; environment?: string };

export function analysisSessionsHref(
  projectId: string,
  range: Range,
  query: string,
  returnTo: string,
  preview?: string,
) {
  const search = new URLSearchParams({
    from: range.from,
    to: range.to,
    q: query,
    analysisReturnTo: returnTo,
  });
  if (range.environment) search.set("environment", range.environment);
  if (preview) search.set("preview", preview);
  return `/projects/${encodeURIComponent(projectId)}/sessions?${search}`;
}

/** A node filter is deliberately not presented as an exact multi-step path match. */
export function pathNodeQuery(event: string): string | undefined {
  if (event.startsWith("page:")) return equalsTerm("route", event.slice(5));
  if (event.startsWith("navigation:")) return equalsTerm("route", event.slice(11));
  if (event.startsWith("event:")) return equalsTerm("event", event.slice(6));
  return undefined;
}

export function analysisReturnHref(projectId: string, search: string) {
  const value = new URLSearchParams(search).get("analysisReturnTo");
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    const base = `/projects/${encodeURIComponent(projectId)}/analytics`;
    return url.origin === window.location.origin &&
      [base, `${base}/funnels`, `${base}/paths`].includes(url.pathname)
      ? `${url.pathname}${url.search}`
      : undefined;
  } catch {
    return undefined;
  }
}
