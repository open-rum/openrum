# Benchmark evidence index

OpenRUM publishes benchmark results only when the method, topology, inputs, acceptance criteria and limitations are retained in the repository. Synthetic load is tagged; production user data is never copied into a benchmark dataset.

- [`initial-capacity.md`](initial-capacity.md) records the 2026-09-03 single-machine overload rehearsal. It failed the release gate and is diagnostic evidence, not a production capacity claim.
- `apps/site/src/content/evidence/local-overload-2026-09-03.json` is the structured subset rendered on the public Benchmarks page.
- `tests/load/ingest-production.js` and `tests/load/query-production.js` are the reproduction entry points.

Before publishing another result, include an immutable run ID, exact OpenRUM commit, k6 output, topology/resource limits, event reconciliation, maximum Kafka lag, recovery time and ClickHouse saturation evidence.
