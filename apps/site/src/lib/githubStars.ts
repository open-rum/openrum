// The star count is read once per build, not in the visitor's browser: the public site loads no
// third-party requests at runtime. A failed lookup (offline, rate limited, not GitHub) simply
// means no count is shown.
let lookup: Promise<number | undefined> | undefined;

export function githubStars(repositoryUrl: string): Promise<number | undefined> {
  lookup ??= fetchStars(repositoryUrl);
  return lookup;
}

async function fetchStars(repositoryUrl: string): Promise<number | undefined> {
  try {
    const url = new URL(repositoryUrl);
    if (url.hostname !== "github.com") return undefined;
    const [owner, name] = url.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    if (!owner || !name) return undefined;
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { stargazers_count?: unknown };
    return typeof body.stargazers_count === "number" ? body.stargazers_count : undefined;
  } catch {
    return undefined;
  }
}

/** Under this many stars a count reads as an empty room, so none is shown. */
export const MIN_STARS_SHOWN = 100;

export function formatStars(count: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
    .format(count)
    .replace("K", "k");
}
