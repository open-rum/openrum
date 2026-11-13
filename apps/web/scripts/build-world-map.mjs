// Builds the behaviour overview's world map from Natural Earth (public domain) country
// shapes, as published by the world-atlas package. The Console ships only the result, so it
// carries no geo dependency at runtime.
//
//   node scripts/build-world-map.mjs <world-atlas/countries-110m.json>
//
// Writes src/features/analytics/overview/worldMap.json: one SVG path per ISO 3166-1 alpha-2
// country in the Equal Earth projection, plus the centre of its largest landmass for
// markers and labels. Places too small for the 1:110m data get a small circle.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const input = process.argv[2];
if (!input) throw new Error("usage: node scripts/build-world-map.mjs <countries-110m.json>");
const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/features/analytics/overview/worldMap.json",
);

const WIDTH = 1000;
const SOUTH = -58; // Antarctica is left out; the map stops just below Tierra del Fuego.
const NORTH = 84;

// world-atlas names whose English region name differs from Intl's.
const aliases = {
  "United States of America": "US",
  "Dem. Rep. Congo": "CD",
  Congo: "CG",
  "Central African Rep.": "CF",
  "S. Sudan": "SS",
  "Dominican Rep.": "DO",
  "Bosnia and Herz.": "BA",
  Macedonia: "MK",
  "North Macedonia": "MK",
  "Eq. Guinea": "GQ",
  "Solomon Is.": "SB",
  "Falkland Is.": "FK",
  "Fr. S. Antarctic Lands": "TF",
  "W. Sahara": "EH",
  "Côte d'Ivoire": "CI",
  eSwatini: "SZ",
  Czechia: "CZ",
  "Timor-Leste": "TL",
  Myanmar: "MM",
  Palestine: "PS",
  "N. Cyprus": null,
  Somaliland: null,
  Kosovo: "XK",
  Taiwan: "TW",
  "Hong Kong": "HK",
  Macao: "MO",
  Turkey: "TR",
  Russia: "RU",
  "South Korea": "KR",
  "North Korea": "KP",
  Laos: "LA",
  Vietnam: "VN",
  Syria: "SY",
  Iran: "IR",
  Moldova: "MD",
  Tanzania: "TZ",
  Bolivia: "BO",
  Venezuela: "VE",
  Brunei: "BN",
  "Puerto Rico": "PR",
  Greenland: "GL",
  "New Caledonia": "NC",
  "Cape Verde": "CV",
  "Trinidad and Tobago": "TT",
};
const english = new Intl.DisplayNames(["en"], { type: "region" });
// Withdrawn or reserved codes that Intl still names after a current country.
const withdrawn = new Set(
  "AN BU CS DD DY EU EZ FX HV NH NT QO RH SU TP UK UN VD YD YU ZR ZZ".split(" "),
);
const byName = new Map();
for (let a = 65; a <= 90; a++)
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    if (withdrawn.has(code)) continue;
    const name = english.of(code);
    if (name && name !== code && !byName.has(name)) byName.set(name, code);
  }
function isoCode(name) {
  if (name in aliases) return aliases[name];
  return byName.get(name) ?? byName.get(name.replace(/\.$/, "")) ?? undefined;
}

// Equal Earth (Šavrič, Patterson, Jenny 2018): equal-area, with straight parallels.
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
function equalEarth(lon, lat) {
  const lambda = (lon * Math.PI) / 180;
  const theta = Math.asin(M * Math.sin((Math.max(SOUTH, Math.min(NORTH, lat)) * Math.PI) / 180));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return [
    (lambda * Math.cos(theta)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
    theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)),
  ];
}
const [maxX] = equalEarth(180, 0);
const [, top] = equalEarth(0, NORTH);
const [, bottom] = equalEarth(0, SOUTH);
const scale = WIDTH / (2 * maxX);
const HEIGHT = Math.ceil((top - bottom) * scale);
const project = (lon, lat) => {
  const [x, y] = equalEarth(lon, lat);
  return [+((x + maxX) * scale).toFixed(1), +((top - y) * scale).toFixed(1)];
};

const topo = JSON.parse(readFileSync(input, "utf8"));
const transform = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [
      x * transform.scale[0] + transform.translate[0],
      y * transform.scale[1] + transform.translate[1],
    ];
  });
});
function ring(indices) {
  const points = [];
  for (const index of indices) {
    const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
    points.push(...(points.length ? arc.slice(1) : arc));
  }
  return points;
}
function polygons(geometry) {
  if (geometry.type === "Polygon") return [geometry.arcs.map(ring)];
  if (geometry.type === "MultiPolygon") return geometry.arcs.map((polygon) => polygon.map(ring));
  return [];
}
/**
 * Cuts a ring that crosses the antimeridian into pieces that each stay on one side, so a
 * projected outline never draws a line across the whole map. Each piece is closed along
 * ±180°.
 */
function splitAtAntimeridian(points) {
  const crossesAt = (a, b) => Math.abs(b[0] - a[0]) > 180;
  if (!points.some((point, i) => i && crossesAt(points[i - 1], point))) return [points];
  const parts = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const [lon1, lat1] = points[i - 1];
    const [lon2, lat2] = points[i];
    if (crossesAt(points[i - 1], points[i])) {
      const edge = lon1 > 0 ? 180 : -180;
      const unwrapped = lon2 + (lon1 > 0 ? 360 : -360);
      const t = (edge - lon1) / (unwrapped - lon1);
      const lat = lat1 + (lat2 - lat1) * t;
      parts.at(-1).push([edge, lat]);
      parts.push([[-edge, lat]]);
    }
    parts.at(-1).push(points[i]);
  }
  // The ring started inside a piece: its last part continues the first.
  if (parts.length > 1) parts[0] = [...parts.pop(), ...parts[0]];
  return parts;
}

/** Signed area and centroid of a projected ring (shoelace). */
function areaCentroid(points) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    area += cross;
    cx += (points[j][0] + points[i][0]) * cross;
    cy += (points[j][1] + points[i][1]) * cross;
  }
  area /= 2;
  return area ? { area: Math.abs(area), x: cx / (6 * area), y: cy / (6 * area) } : null;
}
function pathOf(points) {
  let d = "";
  let last = "";
  for (const [x, y] of points) {
    const step = `${x} ${y}`;
    if (step === last) continue; // drop points that round onto the previous one
    d += (d ? "L" : "M") + step;
    last = step;
  }
  return `${d}Z`;
}

const unmatched = [];
const countries = [];
for (const geometry of topo.objects.countries.geometries) {
  const name = geometry.properties?.name;
  if (name === "Antarctica") continue;
  const code = isoCode(name);
  if (code === null) continue;
  if (!code) {
    unmatched.push(name);
    continue;
  }
  let d = "";
  let largest = null;
  for (const rings of polygons(geometry)) {
    for (const [index, points] of rings.entries()) {
      for (const piece of splitAtAntimeridian(points)) {
        const projected = piece.map(([lon, lat]) => project(lon, lat));
        d += pathOf(projected);
        if (index > 0) continue;
        const centre = areaCentroid(projected);
        if (centre && (!largest || centre.area > largest.area)) largest = centre;
      }
    }
  }
  countries.push({ code, x: +largest.x.toFixed(1), y: +largest.y.toFixed(1), d });
}
if (unmatched.length) throw new Error(`no ISO code for: ${unmatched.join(", ")}`);

// Too small for 1:110m: a small circle so they can still be coloured, hovered and picked.
const extras = [
  ["SG", 103.82, 1.35],
  ["HK", 114.17, 22.32],
  ["MO", 113.55, 22.19],
  ["BH", 50.56, 26.07],
  ["MT", 14.38, 35.94],
  ["MU", 57.55, -20.35],
];
for (const [code, lon, lat] of extras) {
  if (countries.some((country) => country.code === code)) continue;
  const [x, y] = project(lon, lat);
  const r = 2.6;
  countries.push({
    code,
    x,
    y,
    d: `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`,
    point: true,
  });
}

const document = {
  source: "Natural Earth 1:110m via world-atlas@2, Equal Earth projection",
  width: WIDTH,
  height: HEIGHT,
  countries: countries.sort((a, b) => a.code.localeCompare(b.code)),
};
writeFileSync(output, `${JSON.stringify(document)}\n`);
console.log(
  `${document.countries.length} countries, ${WIDTH}×${HEIGHT}, ${JSON.stringify(document).length} bytes → ${output}`,
);
