// Production entry point intentionally reuses the protocol-valid scenario.
// Set EVENT_RATE to 3 × measured peak; the runbook command below makes that explicit.
export { default, options } from "./ingest.js";
