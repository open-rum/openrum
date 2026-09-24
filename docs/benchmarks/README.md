# Benchmark evidence index

OpenRUM publishes benchmark results only when the method, topology, inputs, acceptance criteria and limitations are retained in the repository. Synthetic load is tagged; production user data is never copied into a benchmark dataset.

- [`initial-capacity.md`](initial-capacity.md) records the 2026-09-03 single-machine overload rehearsal. It failed the release gate and is diagnostic evidence, not a production capacity claim.
- [`local-capacity-2026-09-18.md`](local-capacity-2026-09-18.md) records the local hardware, mixed-workload rerun, query pruning, Consumer tuning, rejected experiments and safe reproduction/cleanup procedure.
- `apps/site/src/content/evidence/local-capacity-2026-09-18.json` is the current structured evidence rendered on the homepage and public Benchmarks page. Host RAM and Docker VM RAM are reported separately. The older `local-overload-2026-09-03.json` remains historical evidence.
- `results/2026-09-18/` retains the final k6 summaries and discovery results, including failed load levels. Short passing runs must not be described as production capacity.
- `tests/load/run-local.mjs` runs concurrent local ingest/query tests, records hardware and resources, and verifies accepted/stored/unique event counts. See the report for its isolated fixture and temporary service setup.
- `tests/load/ingest-production.js` and `tests/load/query-production.js` are the reproduction entry points.

Before publishing another result, include an immutable run ID, exact OpenRUM commit, k6 output, topology/resource limits, event reconciliation, maximum Kafka lag, recovery time and ClickHouse saturation evidence.
