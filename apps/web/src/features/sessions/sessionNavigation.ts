import { sessionDetailHref, type SessionSummary } from "@/lib/api/sessions";

export function subscribeSessionLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("openrum:urlchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("openrum:urlchange", callback);
  };
}

export function updateSessionDetailSearch(
  patch: { types?: string; event?: string },
  mode: "push" | "replace" = "push",
) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
  window.dispatchEvent(new Event("openrum:urlchange"));
}

export function sessionDetailHrefFromList(projectId: string, session: SessionSummary) {
  const detail = new URL(sessionDetailHref(projectId, session), window.location.origin);
  const list = new URL(window.location.href);
  list.searchParams.delete("preview");
  detail.searchParams.set("returnTo", `${list.pathname}${list.search}`);
  return `${detail.pathname}${detail.search}`;
}

export function sessionListReturnHref(
  projectId: string,
  search: URLSearchParams,
  from: Date,
  to: Date,
) {
  const expectedPath = `/projects/${encodeURIComponent(projectId)}/sessions`;
  const returnTo = search.get("returnTo");
  if (returnTo) {
    const candidate = new URL(returnTo, window.location.origin);
    if (candidate.origin === window.location.origin && candidate.pathname === expectedPath) {
      return `${candidate.pathname}${candidate.search}`;
    }
  }

  const parameters = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return `${expectedPath}?${parameters}`;
}
