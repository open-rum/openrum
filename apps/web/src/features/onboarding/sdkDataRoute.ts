/** Data views share setup guidance; project management remains available before ingestion. */
export function isSdkDataRoute(pathname: string) {
  return /^\/projects\/[^/]+\/(?:overview|analytics|issues|logs|performance|events|apis|sessions)(?:\/|$)/.test(
    pathname,
  );
}
