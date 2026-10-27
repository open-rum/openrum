/**
 * Pages used to keep each filter in its own URL parameter (release=, browser=, …). The search
 * box now holds every condition in one query (`q`), so those parameters are read once more, as
 * conditions written into the query, and are not written again. Old links keep working and what
 * they filter on becomes visible text.
 */
import { joinTerms, queryTerms } from "./query";
import { formatTerm } from "./terms";

/** field:value, quoted when the value needs it. */
export function equalsTerm(field: string, value: string) {
  return formatTerm({ field, negated: false, operator: "eq", values: [value] });
}

/** A word with no field: the page's own text search. */
export function textTerm(value: string) {
  return formatTerm({ field: "", negated: false, operator: "contains", values: [value] });
}

/** The query with the legacy conditions first, without repeating one already in it. */
export function foldIntoQuery(query: string | undefined | null, legacy: Array<string | undefined>) {
  const existing = queryTerms(query ?? "");
  const added = legacy.filter((term): term is string => Boolean(term) && !existing.includes(term!));
  return joinTerms([...added, ...existing]) || undefined;
}
