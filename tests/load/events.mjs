export function createLoadEvents(batchSize, now, runId, uuid, workload = "custom") {
  const events = Array.from({ length: batchSize }, (_, index) => ({
    event_id: uuid(),
    type: "custom",
    timestamp: now,
    name: "load_probe",
    attributes: { load_run_id: runId, sequence: String(index) },
    measurements: { batch_size: batchSize },
  }));
  if (workload === "mixed") {
    // Fixed 40% custom, 20% PV, 20% API, 10% vital, 10% error.
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      const slot = index % 10;
      if (slot < 4) continue;
      delete event.name;
      delete event.measurements;
      delete event.attributes;
      if (slot < 6) Object.assign(event, { type: "page_view", navigation_type: "navigate" });
      else if (slot < 8)
        Object.assign(event, {
          type: "api",
          request: {
            method: "GET",
            url: "https://load.example.com/api/products",
            status: slot === 7 ? 500 : 200,
            duration_ms: 80 + index,
            transfer_size: 2048,
          },
        });
      else if (slot === 8)
        Object.assign(event, {
          type: "web_vital",
          metric: { name: "LCP", value: 1800 + index, rating: "good" },
        });
      else
        Object.assign(event, {
          type: "error",
          error: {
            name: "TypeError",
            message: `Synthetic benchmark error ${index % 3}`,
            stack: "at benchmark (app.js:1:42)",
            handled: false,
          },
        });
    }
  }
  return events;
}
