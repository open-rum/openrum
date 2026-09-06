# Self-hosted capacity and operating scorecard

This scorecard verifies that an installation is sustainable. It is an operational guardrail, not OpenRUM's positioning or product-value gate.

## Monthly normalized inputs

| Dimension                          |    OpenRUM | Evidence owner      |
| ---------------------------------- | ---------: | ------------------- |
| Accepted events                    |  _pending_ | Data owner          |
| Retained compressed GB-days        |  _pending_ | Data owner          |
| Peak / sustained events per second |  _pending_ | Platform owner      |
| Query P95 / P99                    |  _pending_ | Platform owner      |
| Compute / managed services         | ¥*pending* | FinOps              |
| Storage, backups and network       | ¥*pending* | FinOps              |
| OSS Source Maps                    | ¥*pending* | FinOps              |
| On-call and maintenance hours      |  _pending_ | Engineering manager |
| Total monthly operating cost       | ¥*pending* | FinOps              |

`cost_per_million_events = total_operating_cost ÷ accepted_events × 1,000,000`

## Gates

- Resource use and latency stay within the selected deployment profile with documented headroom.
- Report rejected, dropped and sampled events separately; lower resource use caused by missing data is not an optimization.
- Include backup, monitoring, upgrades and incident labor in operating estimates.
- Cost observations may guide defaults, but do not replace behavior-analysis activation, diagnosis success, privacy or UX acceptance.

Result: **not measured**. Populate during the self-hosted pilot before recommending a production deployment profile.
