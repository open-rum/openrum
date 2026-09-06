# Behavior-to-error product study

## Method

Select at least five real investigations spanning a conversion or key-event drop, an unexpected browser/device/country segment, an unhandled error, a handled error and a slow or failed request. Redact customer identifiers. Ask participants to begin from the same product symptom and stop after 20 minutes or when they reach a defensible product explanation or actionable engineering cause.

At least one product-oriented participant and one engineer must not have implemented the tested OpenRUM feature. Existing tools may be used as a baseline, but no named vendor or cost outcome is a pass condition.

## Per-case record

| Field                                       | Existing tool workflow | OpenRUM   |
| ------------------------------------------- | ---------------------- | --------- |
| Case ID / type                              | _pending_              | _pending_ |
| Participant role                            | _pending_              | _pending_ |
| Time to useful behavior evidence            | _pending_              | _pending_ |
| Time to actionable diagnosis or explanation | _pending_              | _pending_ |
| Successful within 20 minutes                | _pending_              | _pending_ |
| Navigation clicks / system switches         | _pending_              | _pending_ |
| Segment and funnel context sufficient       | _pending_              | _pending_ |
| Session / Source Map / release correct      | _pending_              | _pending_ |
| Missing or misleading evidence              | _pending_              | _pending_ |
| Confidence (1–5)                            | _pending_              | _pending_ |

## Decision

OpenRUM passes when at least 80% of cases reach a defensible explanation or actionable diagnosis, every linked session/error preserves the original behavior filters, no case fails because of silent data loss, and participants can explain sampling/freshness. Record UX friction separately from missing capability.

Study owner: _unassigned_ Cases completed: 0/5 Result: **not started**
