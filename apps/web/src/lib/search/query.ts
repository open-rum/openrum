/**
 * Reading a search query as text: where each term starts and ends, how to colour it, and what
 * the caret is on, so the search box can suggest the right thing and edit the term in place.
 * The language itself is in terms.ts; the server parses the query again and is the authority.
 */
import { formatTerm, parseTerm, type SearchFieldType, type SearchTerm } from "./terms";

export type QueryToken = { text: string; start: number; end: number };

/** Splits on whitespace outside quotes and brackets, keeping each piece's position. */
export function tokenize(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let start = -1;
  let quoted = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index <= query.length; index += 1) {
    const character = query[index];
    if (character === undefined) {
      if (start >= 0) tokens.push({ text: query.slice(start, index), start, end: index });
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      if (start < 0) start = index;
      escaped = true;
      continue;
    }
    const space = /\s/.test(character) && !quoted && depth === 0;
    if (space) {
      if (start >= 0) tokens.push({ text: query.slice(start, index), start, end: index });
      start = -1;
      continue;
    }
    if (start < 0) start = index;
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "[") depth += 1;
    else if (!quoted && character === "]" && depth > 0) depth -= 1;
  }
  return tokens;
}

/** The terms of a query, without the AND that may separate them. */
export function queryTerms(query: string): string[] {
  return tokenize(query)
    .map((token) => token.text)
    .filter((text) => text !== "AND");
}

/** Joins terms the way the search box writes them: "a AND b AND c". */
export function joinTerms(terms: Array<string | undefined>): string {
  return terms.filter((term): term is string => Boolean(term && term.trim())).join(" AND ");
}

/** Adds terms to a query, writing AND between them. */
export function appendTerms(query: string, terms: string[]): string {
  return joinTerms([...queryTerms(query), ...terms]);
}

export type HighlightKind = "field" | "operator" | "value" | "keyword" | "text" | "punctuation";

export type HighlightPart = { text: string; start: number; kind: HighlightKind | "space" };

/** Colours a query: field names, operators, values, AND, and words with no field. */
export function highlight(query: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let position = 0;
  const push = (text: string, kind: HighlightPart["kind"]) => {
    if (text) parts.push({ text, start: position, kind });
    position += text.length;
  };
  for (const token of tokenize(query)) {
    push(query.slice(position, token.start), "space");
    const text = token.text;
    if (text === "AND" || text === "OR" || text === "NOT") {
      push(text, "keyword");
      continue;
    }
    let body = text;
    if (body.startsWith("!") && body.length > 1) {
      push("!", "operator");
      body = body.slice(1);
    }
    if (body.startsWith("has:")) {
      push("has:", "keyword");
      push(body.slice(4), "field");
      continue;
    }
    const colon = unquotedIndex(body, ":");
    const key = colon > 0 ? body.slice(0, colon) : "";
    if (!key || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key) || body.slice(colon + 1).startsWith("//")) {
      push(body, "text");
      continue;
    }
    push(key, "field");
    push(":", "punctuation");
    let rest = body.slice(colon + 1);
    const comparison = /^(>=|<=|>|<)/.exec(rest)?.[0];
    if (comparison) {
      push(comparison, "operator");
      rest = rest.slice(comparison.length);
    }
    // Lists, quotes and wildcards: punctuation and operators around the values they hold.
    let buffer = "";
    let quoted = false;
    const flush = () => {
      push(buffer, "value");
      buffer = "";
    };
    for (const character of rest) {
      if (character === '"') {
        quoted = !quoted;
        buffer += character;
      } else if (!quoted && (character === "[" || character === "]" || character === ",")) {
        flush();
        push(character, "punctuation");
      } else if (!quoted && character === "*") {
        flush();
        push(character, "operator");
      } else buffer += character;
    }
    flush();
  }
  push(query.slice(position), "space");
  return parts;
}

function unquotedIndex(value: string, separator: string) {
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    if (value[index] === separator && !quoted) return index;
  }
  return -1;
}

export type CaretContext =
  | {
      kind: "field";
      /** What has been typed of the field name. */
      prefix: string;
      negated: boolean;
      /** The span of text a chosen field replaces. */
      start: number;
      end: number;
    }
  | {
      kind: "value";
      field: string;
      negated: boolean;
      /** The condition as typed so far, if it reads as one. */
      term?: SearchTerm;
      /** The value being typed, without quotes, wildcards or the list around it. */
      partial: string;
      /** Whether the value sits inside [ ], so a chosen one is added to the list. */
      inList: boolean;
      start: number;
      end: number;
    };

/** What the caret is on: a field name being typed, or the value of a known field. */
export function caretContext(query: string, caret: number): CaretContext {
  const token = tokenize(query).find((item) => caret >= item.start && caret <= item.end);
  if (!token || token.text === "AND")
    return { kind: "field", prefix: "", negated: false, start: caret, end: caret };
  let body = token.text;
  let offset = token.start;
  let negated = false;
  if (body.startsWith("!")) {
    negated = true;
    body = body.slice(1);
    offset += 1;
  }
  if (body.startsWith("has:")) {
    return {
      kind: "field",
      prefix: body.slice(4, Math.max(4, caret - offset)),
      negated,
      start: token.start,
      end: token.end,
    };
  }
  const colon = unquotedIndex(body, ":");
  if (colon < 0 || caret - offset <= colon) {
    return {
      kind: "field",
      prefix: body.slice(0, Math.max(0, caret - offset)),
      negated,
      start: token.start,
      end: token.end,
    };
  }
  const field = body.slice(0, colon);
  const rest = body.slice(colon + 1);
  const inList = rest.startsWith("[");
  const partial = (inList ? (rest.slice(1).replace(/]$/, "").split(",").at(-1) ?? "") : rest)
    .replace(/^(>=|<=|>|<)/, "")
    .replace(/^\*|\*$/g, "")
    .replace(/^"|"$/g, "")
    .trim();
  return {
    kind: "value",
    field,
    negated,
    term: parseTerm(token.text),
    partial,
    inList,
    start: token.start,
    end: token.end,
  };
}

/** Replaces a span of the query, returning the new text and where the caret goes. */
export function replaceSpan(query: string, start: number, end: number, text: string) {
  const before = query.slice(0, start);
  const after = query.slice(end);
  // A new condition after another one reads "… AND new".
  const previous = queryTerms(before).at(-1);
  const joiner = previous && previous !== "AND" && !/\bAND\s*$/.test(before) && text ? "AND " : "";
  const spacedBefore = before && !/\s$/.test(before) ? `${before} ` : before;
  const head = before.trim() ? `${spacedBefore}${joiner}` : "";
  const next = `${head}${text}${after}`;
  return { query: next, caret: head.length + text.length };
}

/** A value written so the parser reads it back as the same text. */
export function quoteValue(value: string) {
  return /[\s"[\],*:]/.test(value) || value === "" ? JSON.stringify(value) : value;
}

export type OperatorShape = {
  label: string;
  negated: boolean;
  shape: "eq" | "in" | "contains" | "prefix" | "has" | "gt" | "gte" | "lt" | "lte";
};

const textShapes: OperatorShape[] = [
  { label: "是", negated: false, shape: "eq" },
  { label: "不是", negated: true, shape: "eq" },
  { label: "属于其中之一", negated: false, shape: "in" },
  { label: "不属于其中任何一个", negated: true, shape: "in" },
  { label: "包含", negated: false, shape: "contains" },
  { label: "不包含", negated: true, shape: "contains" },
  { label: "开头是", negated: false, shape: "prefix" },
  { label: "有值", negated: false, shape: "has" },
  { label: "没有值", negated: true, shape: "has" },
];

const numberShapes: OperatorShape[] = [
  { label: "大于", negated: false, shape: "gt" },
  { label: "大于等于", negated: false, shape: "gte" },
  { label: "小于", negated: false, shape: "lt" },
  { label: "小于等于", negated: false, shape: "lte" },
  { label: "等于", negated: false, shape: "eq" },
  { label: "不等于", negated: true, shape: "eq" },
];

export function operatorShapes(type: SearchFieldType): OperatorShape[] {
  if (type === "number" || type === "duration") return numberShapes;
  if (type === "text") return textShapes;
  return textShapes.filter((shape) => shape.shape !== "contains" && shape.shape !== "prefix");
}

/** Which shape a typed condition already has, so the matching operator shows as chosen. */
export function shapeOf(term: SearchTerm | undefined): Pick<OperatorShape, "negated" | "shape"> {
  if (!term) return { negated: false, shape: "eq" };
  const shape = term.operator === "suffix" ? "contains" : term.operator;
  return { negated: term.negated, shape };
}

/** Writes a condition for a field in a shape, keeping whatever values it already has. */
export function writeShape(field: string, shape: OperatorShape, values: string[]): string {
  const operator = shape.shape;
  const term: SearchTerm = {
    field,
    negated: shape.negated,
    operator,
    values: operator === "has" ? [] : operator === "in" ? values : values.slice(0, 1),
  };
  if (operator !== "has" && !term.values.length) {
    // No value yet: leave the shape open for one to be typed or chosen.
    const prefix = shape.negated ? "!" : "";
    if (operator === "in") return `${prefix}${field}:[]`;
    const opener = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[operator as "gt"] ?? "";
    return `${prefix}${field}:${opener}`;
  }
  return formatTerm(term);
}
