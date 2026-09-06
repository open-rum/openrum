# Self-hosted product pilot rollout

## Scope and owners

Start with one non-critical Web/H5 project, one production environment and low OpenRUM sampling. Existing analytics and monitoring stay unchanged during the first 24 hours so rollback is independent. Record:

- Project / product owner: _unassigned_
- OpenRUM operator: _unassigned_
- Incident approver: _unassigned_
- Start window: _not scheduled_
- Image digest / Helm revision: _pending_
- Key behavior events and one 2–5 step funnel: _pending_

## Current readiness

The local Alpha rehearsal completed on 2026-09-03: a fresh one-command install reached healthy, the seeded demo supported login → behavior analysis → funnel → session/error → mapped Source Map, the dependency recovery drill passed, and the full repository check passed. This proves the self-hosted developer journey, not the real-project pilot.

The pilot is currently **blocked before entry** because the local 3× overload rehearsal failed its latency/error gates, measured production traffic inputs and a production-like Kubernetes rerun are missing, and the owner/start-window fields above are unassigned. Do not check TASK-076 or start sampling until those items are resolved. See `docs/benchmarks/initial-capacity.md` for the evidence and required rerun.

## Entry checklist

- [ ] TASK072 dependency runbook has been followed by an engineer who did not author it.
- [ ] TASK074 production-like 3× peak benchmark meets all gates.
- [ ] Latest backup/restore drill and project-deletion drill pass.
- [ ] Production image has zero unaccepted critical/high findings.
- [ ] Allowed Origins, PII policy, retention, sample rates and Source Map release naming are reviewed.
- [ ] Prometheus alerts, notification channel and on-call ownership are tested.
- [ ] PV, UV, session, key behavior event, funnel step and error definitions are documented.

## Staged rollout

1. Deploy with event/API sample rates at zero and validate health, dependencies and Console login.
2. Enable one internal account/browser canary; verify event acceptance, ≤60-second freshness, error mapping and self-monitoring exclusion.
3. Set low sampling for two hours. Verify page views, custom events, user/session identity, browser/device/country dimensions, errors, ingest rejects, lag and freshness.
4. Have a product user explore one event breakdown and funnel, then have an engineer follow an affected session to an error or confirm that no error exists.
5. If healthy, increase sampling in stages. Expansion beyond 10% requires signed 3× capacity evidence and the first behavior-to-error study result.

## Kill switch

Set the project's emergency event/API sampling to `0` with an expiry, confirm the SDK fetches the new config within five minutes, and watch accepted-event rate fall. If remote configuration is unreachable or the SDK causes page regression, remove/disable OpenRUM initialization through the application's feature flag and deploy the known-good frontend. Do not revoke the key first unless compromise is suspected; revocation prevents queued retry recovery and complicates diagnosis.

Rollback OpenRUM services only to a schema-compatible Helm revision. Existing production tools remain independent throughout rollback.

## Stop conditions

Immediately activate the kill switch for statistically significant Core Web Vital/JS error regression, OpenRUM recursive traffic, PII leakage, unexplained accepted-event loss, browser breakage, sustained ingest failures, misleading user/session identity, retention risk, or any critical security finding. Sampling expansion stops if query P95/P99, freshness, Kafka lag or capacity exceeds its gate.

## First-24-hour sign-off

- [ ] No page error, LCP/INP/CLS or API failure regression attributable to the SDK.
- [ ] Accepted events reconcile through Kafka and ClickHouse.
- [ ] A non-author completes event breakdown and funnel exploration without help.
- [ ] At least one behavior segment reaches a session timeline; linked errors reach the correct Issue/Source Map state.
- [ ] Alerts and deep links are actionable; no alert storm.
- [ ] On-call confirms kill switch and rollback access.
- [ ] Product owner approves continuing the pilot.

Approval: _not signed_ Date: _pending_
