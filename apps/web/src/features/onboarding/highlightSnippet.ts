export type SnippetToken = {
  text: string;
  kind?: "comment" | "string" | "keyword" | "function" | "property" | "tag";
};

/** Lightweight highlighting for our generated JS/HTML snippets, preserving the exact source. */
export function highlightSnippet(source: string): SnippetToken[] {
  const pattern =
    /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?<tag><\/?[a-zA-Z][\w-]*)|(?<keyword>\b(?:import|from|export|default|function|var|let|const|return|if|true|false|null)\b)|(?<property>\b[a-zA-Z_$][\w$]*(?=\s*[:=]))|(?<function>\b[a-zA-Z_$][\w$]*(?=\s*\())/g;
  const tokens: SnippetToken[] = [];
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > offset) tokens.push({ text: source.slice(offset, match.index) });
    const kind = Object.keys(match.groups ?? {}).find(
      (key) => match.groups?.[key] !== undefined,
    ) as SnippetToken["kind"];
    tokens.push({ text: match[0], kind });
    offset = match.index + match[0].length;
  }
  if (offset < source.length) tokens.push({ text: source.slice(offset) });
  return tokens;
}
