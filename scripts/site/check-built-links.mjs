import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "apps/site/dist");
const pages = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extname(path) === ".html") pages.push(resolve(path));
  }
}

await walk(dist);
const pageSet = new Set(pages);
const inbound = new Map(pages.map((page) => [page, new Set()]));
const canonicalOwners = new Map();
const htmlByPage = new Map(
  await Promise.all(pages.map(async (page) => [page, await readFile(page, "utf8")])),
);
const failures = [];

function isRedirect(html) {
  return /http-equiv=["']refresh["']/i.test(html);
}

for (const page of pages) {
  const html = htmlByPage.get(page);
  if (isRedirect(html)) continue;
  const canonicals = [
    ...html.matchAll(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi),
  ].map((match) => match[1]);
  if (canonicals.length !== 1) {
    failures.push(`${display(page)}: expected one canonical link, found ${canonicals.length}`);
  } else {
    const owners = canonicalOwners.get(canonicals[0]) ?? [];
    owners.push(page);
    canonicalOwners.set(canonicals[0], owners);
  }

  if (!html.includes("data-openrum-build")) {
    failures.push(`${display(page)}: missing Release/commit build marker`);
  }

  for (const match of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href.startsWith("/") && !href.startsWith("#")) continue;
    if (href.startsWith("//") || href.startsWith("/api/")) continue;
    const [pathnamePart, fragment] = href.split("#", 2);
    const pathname = (pathnamePart || routeFor(page)).split("?")[0];
    const target = await resolveTarget(pathname);
    if (!target) {
      failures.push(`${display(page)}: missing internal target ${href}`);
      continue;
    }
    if (pageSet.has(target) && target !== page) inbound.get(target).add(page);
    if (fragment && pageSet.has(target)) {
      const decoded = decodeURIComponent(fragment);
      const targetHTML = htmlByPage.get(target);
      if (!targetHTML.includes(`id="${escapeAttribute(decoded)}"`)) {
        failures.push(`${display(page)}: missing fragment target ${href}`);
      }
    }
  }
}

for (const [canonical, owners] of canonicalOwners) {
  if (owners.length > 1) {
    failures.push(`duplicate canonical ${canonical}: ${owners.map(display).join(", ")}`);
  }
}

for (const page of pages) {
  const route = routeFor(page);
  if (route === "/" || /\/404(?:\.html)?\/?$/.test(route)) continue;
  if (isRedirect(htmlByPage.get(page))) continue;
  if (inbound.get(page).size === 0)
    failures.push(`${display(page)}: orphan page has no inbound link`);
}

if (failures.length) {
  console.error(`Public-site content graph failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(
  `Checked ${pages.length} HTML pages; links, fragments, canonicals, build markers and inbound page graph pass.`,
);

async function resolveTarget(pathname) {
  const relativeTarget = pathname.replace(/^\/+/, "");
  const direct = resolve(dist, relativeTarget);
  if (!direct.startsWith(resolve(dist))) return null;
  const candidates = pathname.endsWith("/")
    ? [join(direct, "index.html")]
    : [direct, `${direct}.html`, join(direct, "index.html")];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return resolve(candidate);
    } catch {
      // Try the next static-server resolution form.
    }
  }
  return null;
}

function routeFor(page) {
  const path = relative(dist, page).replaceAll("\\", "/");
  if (path === "index.html") return "/";
  if (path.endsWith("/index.html")) return `/${path.slice(0, -"index.html".length)}`;
  return `/${path.replace(/\.html$/, "")}`;
}

function display(page) {
  return relative(root, page);
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
