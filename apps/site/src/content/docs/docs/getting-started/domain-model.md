---
title: Domain model
description: Shared terminology for Instance, Organization, Project, Event, Session, Issue and Release.
---

OpenRUM documentation, Console labels and APIs share one glossary. The repository root `CONTEXT.md` is the canonical source. Prefer these terms; avoid the listed synonyms.

## Ownership and delivery

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Instance** | One self-hosted OpenRUM installation and its global operational policy boundary. | Tenant, cluster, workspace |
| **Instance Administrator** | Operator who manages instance-wide configuration, data lifecycle and dependencies. | Super admin, organization admin |
| **Organization** | Team boundary that owns Projects, members and access policies. | Tenant, account, workspace |
| **Project** | One web product monitored as a single reporting boundary. | App, application, service |
| **Environment** | Deployment scope inside a Project, such as production or staging. | Stage, namespace |
| **Release** | Deployed build identity used to relate observations to a delivery. | Version, deployment |

## Observation

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Event** | Immutable observation captured from a monitored Project at a point in time. | Log, record, message |
| **Page View** | Event for a browser page or client-side route becoming visible. | Hit, impression |
| **Session** | Bounded period of browser activity that relates a visitor's Events into one journey. | Visit, replay |
| **Issue** | Stable group of equivalent error Events investigated together. | Error, exception, incident |
| **Fingerprint** | Versioned stable identity that decides which error Events belong to the same Issue. | Issue ID, hash, signature |
| **Issue State** | Project-specific workflow state attached to an Issue. | Error status, event status |
| **Web Vital** | Real-user experience measurement such as LCP, INP or CLS. | Performance event, timing |
| **API Request** | Browser-originated network operation observed in a Page View or Session. | Endpoint, trace |
| **Custom Event** | Project-defined business observation with explicit properties and measurements. | Track, metric event |

## Diagnostic artifacts

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Session Replay** | Privacy-filtered reconstruction of visible browser experience inside a Session. | Recording, video |
| **Source Map Artifact** | Build artifact that maps generated code locations back to authored source for a Release. | Source map file, debug file |
| **Upload Token** | Revocable Project-scoped secret that lets CI create Releases and upload Source Map Artifacts without a Console session. | API key, CI token, session token |

## How the terms connect

A visitor generates **Events** inside a **Session**. Behavior analytics aggregate Page Views and Custom Events. JavaScript failures become error Events, grouped into an **Issue** by **Fingerprint**. Operators investigate from a behavior change or failed Session into the Issue and optional Source Map Artifact for a **Release**, without copying IDs between tools.
