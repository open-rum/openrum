export const OPENRUM_INGEST_PATH = "/ingest/v1/envelope";
export const OPENRUM_BROWSER_SDK_VERSION = "0.1.0";
export const OPENRUM_BROWSER_SDK_PATH = `/sdk/browser/${OPENRUM_BROWSER_SDK_VERSION}/openrum.min.js`;

export type ParsedOpenRUMDSN = {
  endpoint: string;
  writeKey: string;
};

/**
 * Creates the single public connection string copied into the Browser SDK.
 * The write key is URL user-info, matching the familiar Sentry-style DSN
 * shape; it is removed before any network request is made.
 */
export function createOpenRUMDSN(endpoint: string | URL, writeKey: string): string {
  const url = parseHTTPURL(endpoint, "OpenRUM DSN endpoint");
  const key = writeKey.trim();
  if (!key) throw new TypeError("OpenRUM DSN requires a write key");
  if (url.username || url.password) {
    throw new TypeError("OpenRUM DSN endpoint must not contain credentials");
  }
  url.username = key;
  return url.toString();
}

export function createOpenRUMDSNForInstance(publicBaseURL: string | URL, writeKey: string): string {
  return createOpenRUMDSN(new URL(OPENRUM_INGEST_PATH, publicBaseURL), writeKey);
}

/** Parses a DSN and returns credentials separately from the request URL. */
export function parseOpenRUMDSN(dsn: string): ParsedOpenRUMDSN {
  const url = parseHTTPURL(dsn, "OpenRUM DSN");
  if (!url.username || url.password) {
    throw new TypeError("OpenRUM DSN must contain one public write key");
  }
  let writeKey: string;
  try {
    writeKey = decodeURIComponent(url.username);
  } catch {
    throw new TypeError("OpenRUM DSN contains an invalid write key");
  }
  if (!writeKey) throw new TypeError("OpenRUM DSN must contain one public write key");
  url.username = "";
  url.password = "";
  return { endpoint: url.toString(), writeKey };
}

function parseHTTPURL(value: string | URL, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`${label} must use http or https`);
  }
  if (url.search || url.hash) {
    throw new TypeError(`${label} must not contain a query or fragment`);
  }
  return url;
}
