---
title: Investigation
description: Move from a behavior change to Session, Issue and root cause.
---

**Applies to:** Alpha.

OpenRUM keeps behavior analytics and error monitoring in one investigation path so operators do not copy IDs between tools.

## Behavior → Session → Issue

1. **Spot the change** in Analysis: PV/UV, Custom Events, funnels, geography, device or browser segments.
2. **Open Sessions** for the affected Route or cohort and inspect the ordered timeline of Page Views, interactions, API Requests and errors.
3. **Follow an error Event to its Issue** and review Fingerprint, impact, Release and whether the problem is new.
4. **Confirm the root cause** with Session context and the failed API Request. When object storage is configured, resolve a mapped original source frame from the Source Map Artifact.

## Evidence you should expect

| Signal | Where | Why it matters |
| --- | --- | --- |
| Behavior drop or spike | Analysis | Starts the investigation without assuming an error |
| Session timeline | Sessions | Reconstructs what the user did before failure |
| Grouped errors | Issues | Separates one-off noise from recurring production issues |
| Failed API Request | API / Session | Explains blocked user journeys |
| Mapped stack frame | Issue / Release | Speeds authored-source diagnosis when available |

## Demo walkthrough

After the local Quickstart, use the seeded ecommerce path: product behavior → checkout Session → `v1:demo-checkout` Issue → failed `POST /api/orders`. See [Deterministic Demo data](/docs/getting-started/demo-data/).
