/** Only shared analysis context crosses projects; entity IDs and page searches do not. */
export function projectSwitchDestination(projectId: string, pathname: string, search: string) {
  const analysis = pathname.match(
    /^\/projects\/[^/]+\/(overview|analytics(?:\/(?:funnels|paths|retention))?|issues|logs|performance|events|apis|sessions)(?:\/.*)?$/,
  );
  const settings = pathname.match(
    /^\/settings\/project\/[^/]+\/(general|sampling|quota|filters|api-capture|url-rules|scrubbing|usage|sourcemaps)$/,
  );
  const utility = pathname.match(/^\/projects\/[^/]+\/(alerts|onboarding)$/);
  const parameters = new URLSearchParams(search);
  const shared = Object.fromEntries(
    ["from", "to", "timePreset", "environment"].flatMap((key) =>
      parameters.has(key) ? [[key, parameters.get(key)!]] : [],
    ),
  );
  return settings
    ? { to: `/settings/project/${encodeURIComponent(projectId)}/${settings[1]}`, search: {} }
    : utility
      ? { to: `/projects/${encodeURIComponent(projectId)}/${utility[1]}`, search: {} }
      : {
          to: `/projects/${encodeURIComponent(projectId)}/${analysis?.[1] ?? "overview"}`,
          search: shared,
        };
}
