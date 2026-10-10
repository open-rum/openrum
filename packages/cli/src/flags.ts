/**
 * Reads `--name value`, `--name=value` and bare boolean flags into a map. Unknown positional
 * words are ignored here; the caller decides what a leftover word means.
 */
export function parseFlags(args: string[], booleanFlags: ReadonlySet<string>): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (!argument.startsWith("--")) continue;
    const [key, inline] = argument.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (!key) continue;
    if (inline !== undefined) flags.set(key, inline);
    else if (booleanFlags.has(key)) flags.set(key, "true");
    else {
      const value = args[index + 1];
      if (value !== undefined && !value.startsWith("--")) {
        flags.set(key, value);
        index += 1;
      }
    }
  }
  return flags;
}

export function enabled(value: string | undefined): boolean {
  return value !== undefined && /^(?:1|true|yes)$/i.test(value);
}
