import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { createLoadEvents } from "./events.mjs";

const batchSize = Number(__ENV.BATCH_SIZE || 100);
const eventRate = Number(__ENV.EVENT_RATE || 10000);
const requestRate = Math.max(1, Math.ceil(eventRate / batchSize));
const duration = __ENV.DURATION || "30s";
const runId = __ENV.RUN_ID || `load-${Date.now()}`;
const acceptedEvents = new Counter("openrum_accepted_events");

export const options = {
  scenarios: {
    ingest: {
      executor: "constant-arrival-rate",
      rate: requestRate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 200),
      maxVUs: Number(__ENV.MAX_VUS || 1000),
    },
  },
  thresholds: {
    checks: ["rate==1"],
    dropped_iterations: ["count==0"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<250"],
  },
};

export default function () {
  const sessionId = uuid();
  const pageId = uuid();
  const now = new Date().toISOString();
  const events = createLoadEvents(batchSize, now, runId, uuid, __ENV.WORKLOAD);
  const body = JSON.stringify({
    schema_version: "1.0",
    sent_at: now,
    sdk: { name: "openrum-k6", version: "1.0.0" },
    context: {
      environment: __ENV.OPENRUM_ENVIRONMENT || "production",
      session_id: sessionId,
      page_id: pageId,
      anonymous_user_id: `load-${sessionId}`,
      page: {
        url: `${__ENV.PAGE_URL || "https://load.example.com"}/run/${runId}`,
        route: "/benchmark",
      },
      tags: { load_run_id: runId },
    },
    events,
  });
  const response = http.post(
    __ENV.OPENRUM_INGEST_URL || "http://127.0.0.1:8081/ingest/v1/envelope",
    body,
    {
      headers: {
        "Content-Type": "application/json",
        "X-OpenRUM-Key": __ENV.OPENRUM_WRITE_KEY,
        Origin: __ENV.OPENRUM_ORIGIN || "https://load.example.com",
      },
    },
  );
  let count = 0;
  try {
    count = Number(response.json("accepted") || 0);
  } catch {
    /* Invalid/empty responses are not accepted events. */
  }
  check(response, {
    "entire batch durably accepted": (current) =>
      (current.status === 202 || current.status === 207) && count === batchSize,
  });
  acceptedEvents.add(count);
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
