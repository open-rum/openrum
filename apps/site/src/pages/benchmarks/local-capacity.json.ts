import evidence from "../../content/evidence/local-capacity-2026-09-18.json";

export const prerender = true;

export function GET() {
  return new Response(JSON.stringify(evidence, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
