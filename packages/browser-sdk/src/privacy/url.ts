export function sanitizeURL(raw: string | URL, base?: string): string | undefined {
  try {
    const parsed = new URL(String(raw), base ?? browserBaseURL());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().slice(0, 2_048);
  } catch {
    const value = String(raw).split(/[?#]/, 1)[0]?.slice(0, 2_048);
    return value?.startsWith("/") ? value : undefined;
  }
}

export function isIngestURL(requestURL: string | URL, endpoint: string, base?: string): boolean {
  const normalizedRequest = sanitizeURL(requestURL, base);
  const normalizedEndpoint = sanitizeURL(endpoint, base);
  return Boolean(
    normalizedRequest && normalizedEndpoint && normalizedRequest === normalizedEndpoint,
  );
}

function browserBaseURL(): string | undefined {
  return typeof location === "undefined" ? undefined : location.href;
}
