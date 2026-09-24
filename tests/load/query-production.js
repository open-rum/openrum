import http from "k6/http";
import { check } from "k6";

const rate = Number(__ENV.QUERY_RATE || 100);
const duration = __ENV.DURATION || "15m";
const baseURL = (__ENV.OPENRUM_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const projectID = __ENV.OPENRUM_PROJECT_ID;
const session = __ENV.OPENRUM_SESSION;

export const options = {
  scenarios: {
    query: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 100),
      maxVUs: Number(__ENV.MAX_VUS || 500),
    },
  },
  thresholds: {
    checks: ["rate==1"],
    dropped_iterations: ["count==0"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
  },
};

const paths = ["overview", "issues", "performance", "apis", "usage"];

export function setup() {
  if (!projectID || !session) {
    throw new Error("OPENRUM_PROJECT_ID and OPENRUM_SESSION are required");
  }
}

export default function () {
  const resource = paths[Math.floor(Math.random() * paths.length)];
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}&environment=production`;
  const response = http.get(`${baseURL}/api/v1/projects/${projectID}/${resource}?${query}`, {
    headers: { Cookie: `openrum_session=${session}` },
    tags: { name: `GET /api/v1/projects/{projectId}/${resource}` },
  });
  check(response, { "authorized query succeeds": (current) => current.status === 200 });
}
