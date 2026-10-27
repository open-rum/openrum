/**
 * The Console side of the shared search language (`internal/search` on the server). The server
 * parses every search again and is the authority; this file only reads terms well enough to
 * show them as tokens, offer operators and explain a refusal.
 *
 *   route:/checkout   !route:/checkout   browser:[Chrome,Safari]   route:*checkout*
 *   route:/api/*      route:*.js         has:trace_id   !has:trace_id   status:>=500
 *   duration:>2s      timeout (a bare word: the page's own text search)
 */

export type SearchFieldType = "text" | "enum" | "uuid" | "number" | "duration";

export type SearchOperator =
  "eq" | "in" | "contains" | "prefix" | "suffix" | "has" | "gt" | "gte" | "lt" | "lte";

export type SearchTerm = {
  /** Empty for a bare word. */
  field: string;
  negated: boolean;
  operator: SearchOperator;
  values: string[];
};

export const MAX_SEARCH_TERMS = 12;

type OperatorChoice = {
  operator: SearchOperator;
  negated: boolean;
  label: string;
  /** "none" adds at once; "many" takes a comma-separated list. */
  values: "one" | "many" | "none";
};

const textChoices: OperatorChoice[] = [
  { operator: "eq", negated: false, label: "是", values: "one" },
  { operator: "eq", negated: true, label: "不是", values: "one" },
  { operator: "in", negated: false, label: "属于其中之一", values: "many" },
  { operator: "in", negated: true, label: "不属于其中任何一个", values: "many" },
  { operator: "contains", negated: false, label: "包含", values: "one" },
  { operator: "contains", negated: true, label: "不包含", values: "one" },
  { operator: "prefix", negated: false, label: "开头是", values: "one" },
  { operator: "has", negated: false, label: "有值", values: "none" },
  { operator: "has", negated: true, label: "没有值", values: "none" },
];

const enumChoices = textChoices.filter(
  (choice) => !["contains", "prefix", "suffix"].includes(choice.operator),
);

const numberChoices: OperatorChoice[] = [
  { operator: "gt", negated: false, label: "大于", values: "one" },
  { operator: "gte", negated: false, label: "大于等于", values: "one" },
  { operator: "lt", negated: false, label: "小于", values: "one" },
  { operator: "lte", negated: false, label: "小于等于", values: "one" },
  { operator: "eq", negated: false, label: "等于", values: "one" },
  { operator: "eq", negated: true, label: "不等于", values: "one" },
];

/** The operators a field of this type takes, in the order the picker lists them. */
export function operatorChoices(type: SearchFieldType): OperatorChoice[] {
  if (type === "number" || type === "duration") return numberChoices;
  if (type === "text") return textChoices;
  return enumChoices;
}

export type { OperatorChoice };

/** Splits a search into terms on whitespace outside quotes and brackets. */
export function splitQuery(query: string): string[] {
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  let depth = 0;
  for (const character of query.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "[") depth += 1;
    else if (!quoted && character === "]" && depth > 0) depth -= 1;
    if (/\s/.test(character) && !quoted && depth === 0) {
      if (current) terms.push(current);
      current = "";
    } else current += character;
  }
  if (current) terms.push(current);
  return terms;
}

export function joinQuery(terms: string[]) {
  return terms.filter(Boolean).join(" ") || undefined;
}

const fieldPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

function unquote(value: string) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  return value;
}

function splitList(value: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (const character of value) {
    if (character === '"') quoted = !quoted;
    if (character === "," && !quoted) {
      values.push(unquote(current.trim()));
      current = "";
    } else current += character;
  }
  if (current.trim()) values.push(unquote(current.trim()));
  return values.filter(Boolean);
}

/** Reads one term. Returns undefined for something the server would refuse to parse. */
export function parseTerm(raw: string): SearchTerm | undefined {
  let body = raw.trim();
  if (!body || body === "AND" || body === "OR" || body === "NOT") return undefined;
  let negated = false;
  if (body.startsWith("!") && body.length > 1) {
    negated = true;
    body = body.slice(1);
  }
  if (body.startsWith("has:")) {
    const field = body.slice(4);
    return fieldPattern.test(field) ? { field, negated, operator: "has", values: [] } : undefined;
  }
  const colon = body.indexOf(":");
  const key = colon > 0 ? body.slice(0, colon) : "";
  const rest = colon > 0 ? body.slice(colon + 1) : "";
  if (!key || !fieldPattern.test(key) || rest.startsWith("//") || key.includes('"')) {
    const value = unquote(body);
    return value ? { field: "", negated, operator: "contains", values: [value] } : undefined;
  }
  if (!rest) return undefined;
  if (rest.startsWith("[")) {
    if (!rest.endsWith("]")) return undefined;
    const values = splitList(rest.slice(1, -1));
    return values.length ? { field: key, negated, operator: "in", values } : undefined;
  }
  for (const [prefix, operator] of [
    [">=", "gte"],
    ["<=", "lte"],
    [">", "gt"],
    ["<", "lt"],
  ] as const) {
    if (rest.startsWith(prefix)) {
      const value = rest.slice(prefix.length);
      return value ? { field: key, negated, operator, values: [value] } : undefined;
    }
  }
  if (rest.startsWith('"')) {
    const value = unquote(rest);
    return value ? { field: key, negated, operator: "eq", values: [value] } : undefined;
  }
  if (rest === "*") return { field: key, negated, operator: "has", values: [] };
  const leading = rest.startsWith("*");
  const trailing = rest.endsWith("*");
  const inner = rest.replace(/^\*/, "").replace(/\*$/, "");
  if (!inner || inner.includes("*")) return undefined;
  const operator: SearchOperator =
    leading && trailing ? "contains" : leading ? "suffix" : trailing ? "prefix" : "eq";
  return { field: key, negated, operator, values: [inner] };
}

/** True when the text is more than a plain field:value, so it needs the search language. */
export function usesOperators(term: SearchTerm) {
  return term.negated || term.operator !== "eq";
}

function quote(value: string) {
  return /[\s"[\],*]/.test(value) || value === "" ? JSON.stringify(value) : value;
}

/** Writes a term the server reads back as the same condition. */
export function formatTerm(term: SearchTerm): string {
  const prefix = term.negated ? "!" : "";
  if (term.operator === "has") return `${prefix}has:${term.field}`;
  const value = term.values[0] ?? "";
  if (!term.field) return prefix + quote(value);
  const body = (() => {
    switch (term.operator) {
      case "in":
        return `[${term.values.map((item) => (/[\s",[\]]/.test(item) ? JSON.stringify(item) : item)).join(",")}]`;
      case "contains":
        return `*${value}*`;
      case "prefix":
        return `${value}*`;
      case "suffix":
        return `*${value}`;
      case "gt":
        return `>${value}`;
      case "gte":
        return `>=${value}`;
      case "lt":
        return `<${value}`;
      case "lte":
        return `<=${value}`;
      default:
        return quote(value);
    }
  })();
  return `${prefix}${term.field}:${body}`;
}

const operatorWords: Record<SearchOperator, [string, string]> = {
  eq: ["是", "不是"],
  in: ["属于", "不属于"],
  contains: ["包含", "不包含"],
  prefix: ["开头是", "开头不是"],
  suffix: ["结尾是", "结尾不是"],
  has: ["有值", "没有值"],
  gt: [">", "不大于"],
  gte: ["≥", "小于"],
  lt: ["<", "不小于"],
  lte: ["≤", "大于"],
};

/** A token label such as "浏览器 不是 Chrome" or "耗时 > 2s". */
export function describeTerm(
  term: SearchTerm,
  fieldLabel: (field: string) => string,
  freeTextLabel = "关键词",
  valueLabel: (field: string, value: string) => string = (_field, value) => value,
): string {
  const label = term.field ? fieldLabel(term.field) : freeTextLabel;
  const word = operatorWords[term.operator][term.negated ? 1 : 0];
  if (term.operator === "has") return `${label} ${word}`;
  const values = term.values.map((value) => valueLabel(term.field, value)).join("、");
  return `${label} ${word} ${values}`;
}

/** Turns the server's refusal (`error.search.code`) into words. */
export function searchErrorMessage(code: string | undefined, term?: string) {
  const at = term ? `「${term}」` : "";
  switch (code) {
    case "too_long":
      return "搜索太长了，最多 1024 个字符。";
    case "too_many_terms":
      return `最多 ${MAX_SEARCH_TERMS} 个条件。`;
    case "unterminated_quote":
      return `${at}的引号没有闭合。`;
    case "boolean_keyword":
      return "不支持 AND、OR、NOT。多个条件之间默认是“并且”；“或”请写成 字段:[值1,值2]，“不是”请在前面加 !。";
    case "empty_value":
      return `${at}缺少值。`;
    case "wildcard_position":
      return `${at}里的 * 只能放在值的开头或结尾。`;
    case "too_many_values":
      return `${at}最多列出 20 个值。`;
    case "unknown_field":
      return `这个页面不能按${at}里的字段搜索。`;
    case "unsupported_operator":
      return `${at}这个字段不支持这种比较。`;
    case "invalid_value":
      return `${at}的值格式不对。`;
    case "free_text_unsupported":
      return "这个页面不支持关键词搜索，请选择一个字段。";
    default:
      return "搜索条件无效。";
  }
}

const recentLimit = 10;

/** The last searches added on a page, kept in this browser only. */
export function readRecentTerms(key: string): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(`openrum:recent-search:${key}`) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function rememberTerm(key: string, term: string) {
  try {
    const next = [term, ...readRecentTerms(key).filter((item) => item !== term)].slice(
      0,
      recentLimit,
    );
    window.localStorage.setItem(`openrum:recent-search:${key}`, JSON.stringify(next));
  } catch {
    // A private window or blocked storage only loses the convenience.
  }
}
