export function splitTerms(query: string) {
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of query.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (/\s/.test(character) && !quoted) {
      if (current) terms.push(current);
      current = "";
    } else current += character;
  }
  if (current) terms.push(current);
  return terms;
}
