---
title: Glossary and core concepts
description: The terms OpenRUM uses for Instance, Organization, Project, Event, Session, Issue, Release and the Console, with the words to avoid.
appliesTo: Alpha
---

OpenRUM documentation, Console labels and APIs share one glossary. The repository root `CONTEXT.md` is the canonical source. Prefer these terms; avoid the listed synonyms.

## Ownership and delivery

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Console** | The authenticated operator interface for inspecting Project observations and managing Project, Organization and Instance configuration. | Dashboard, admin panel, back office |
| **Instance** | One self-hosted OpenRUM installation and its global operational policy boundary. | Tenant, cluster, workspace |
| **Instance Administrator** | Operator who manages instance-wide configuration, data lifecycle, dependencies and maintenance independently of Organization roles. | Super admin, organization admin |
| **Organization** | Team boundary that owns Projects, members and access policies. | Tenant, account, workspace |
| **Project** | One web product monitored as a single reporting boundary. A Project can contain several Environments. | App, application, service |
| **SDK Platform** | The frontend framework or toolchain selected for a Project, such as JavaScript, React, Vue or Next.js. It chooses the onboarding recipe and Project icon; it does not change accepted Event types or Environment boundaries. | Project type, runtime, event platform |
| **Environment** | Deployment scope inside a Project, such as production, canary, test or development. | Stage, namespace |
| **Project Settings** | Configuration and operating tools whose scope is the currently selected Project. | App settings, project management |
| **Project Rate Limit** | A per-second request boundary shared by every DSN and Environment in one Project. It counts Ingest requests, not the Events they carry. | Environment quota, event limit, sampling rate |
| **Instance Settings** | Configuration and maintenance controls whose scope is the whole Instance, visible only to an Instance Administrator. | System management, super-admin settings |
| **Release** | Deployed build identity used to relate observations to a delivery. | Version, deployment |

## Observation

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Event** | Immutable observation captured from a monitored Project at a point in time. | Log, record, message |
| **Log** | A diagnostic Event (`type=log`) with a severity, message and structured attributes. Logs are emitted through the Browser SDK logger or selected `captureConsole` methods, and can be related by Session or supplied trace context. They do not create an Issue or count as a Custom Event. | Error, Issue, Custom Event |
| **Page View** | Event for a browser page or client-side route becoming visible. | Hit, impression |
| **Session** | Bounded period of browser activity that relates a visitor's Events into one journey. It ends after 30 minutes of inactivity and rotates after 24 hours of continuous activity. | Visit, replay |
| **Issue** | Stable group of equivalent error Events investigated together. | Error, exception, incident |
| **Fingerprint** | Versioned stable identity that decides which error Events belong to the same Issue. | Issue ID, hash, signature |
| **Issue State** | Project-specific workflow state attached to an Issue, independent of its immutable error Events. | Error status, event status |
| **Regression** | A resolved Issue that fails again after it was marked resolved. The Console shows it as regressed until someone resolves it again. | Reopened, recurrence |
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

An **Instance** holds **Organizations**, an Organization holds **Projects**, and a Project reports one or more **Environments**. People get access through Organization roles, and Instance Administrators manage the installation. See [Organizations, Projects and roles](/docs/product/organizations-and-projects/) and [Roles and permissions](/docs/product/roles-permissions/).
