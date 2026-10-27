import type { BehaviorDimension } from "@/lib/api/analytics";
import { HTTPError } from "@/lib/auth/session";
import { queryTerms } from "@/lib/search/query";
import { parseTerm } from "@/lib/search/terms";

/**
 * The split that lets a one-condition search read the rollup instead of raw events: the
 * condition's own country, device, browser or property, when it is "is" or "one of".
 */
export function rollupSplit(
  q?: string,
): { dimension: BehaviorDimension; label: string } | undefined {
  const terms = queryTerms(q ?? "");
  const term = terms.length === 1 ? parseTerm(terms[0]!) : undefined;
  if (!term || term.negated || (term.operator !== "eq" && term.operator !== "in")) return undefined;
  const labels: Record<string, string> = {
    country: "按国家",
    device: "按设备",
    browser: "按浏览器",
  };
  if (labels[term.field])
    return { dimension: term.field as BehaviorDimension, label: `${labels[term.field]}拆分` };
  const property = term.field.startsWith("attributes.") ? term.field.slice(11) : "";
  return property
    ? { dimension: `property:${property}`, label: `按属性 ${property} 拆分` }
    : undefined;
}

/** The server refused a search that would read too many raw events for the range. */
export function tooExpensive(error: unknown, q?: string) {
  return Boolean(q) && error instanceof HTTPError && error.code === "QUERY_TOO_EXPENSIVE";
}
