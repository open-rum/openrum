# OpenRUM

OpenRUM observes real-user behavior and frontend reliability across monitored web products. This glossary keeps the console, browser SDK, ingestion services, and product documentation aligned on one domain language.

## Ownership and Delivery

**Console**:
The authenticated operator interface for inspecting project observations and managing Project, Organization, and Instance configuration.
_Avoid_: Dashboard, admin panel, back office

**Instance**:
One self-hosted OpenRUM installation and its global operational policy boundary.
_Avoid_: Tenant, cluster, workspace

**Instance Administrator**:
An operator who manages instance-wide configuration, data lifecycle, external dependencies, and maintenance independently of organization roles.
_Avoid_: Super admin, organization admin

**Organization**:
A team boundary that owns monitored projects, members, and access policies.
_Avoid_: Tenant, account, workspace

**Project**:
A web product whose browser activity is monitored as one reporting boundary. A Project can contain several Environments.
_Avoid_: App, application, service

**SDK Platform**:
The frontend framework or browser toolchain selected for a Project, such as JavaScript, React, Vue, or Next.js. It chooses the onboarding recipe and Project icon; it does not change accepted Event types or Environment boundaries.
_Avoid_: Project type, runtime, event platform

**Environment**:
A deployment scope within a Project, such as production, canary, test, or development.
_Avoid_: Stage, namespace

**Project Settings**:
Configuration and operating tools whose scope is the currently selected Project.
_Avoid_: App settings, project management

**Project Rate Limit**:
A per-second request boundary shared by every DSN and Environment in one Project. It counts Ingest requests rather than the Events carried by those requests.
_Avoid_: Environment quota, event limit, sampling rate

**Instance Settings**:
Configuration and maintenance controls whose scope is the whole Instance and which are visible only to an Instance Administrator.
_Avoid_: System management, super-admin settings

**Release**:
A deployed build identity used to relate observations to a specific delivery of a project.
_Avoid_: Version, deployment

## Observation

**Event**:
An immutable observation captured from a monitored project at a point in time.
_Avoid_: Log, record, message

**Log**:
A diagnostic Event (`type=log`) with a severity, message and structured attributes. Logs are explicitly emitted through the Browser SDK logger or selected `captureConsole` methods and can be related by Session or supplied trace context; they do not create an Issue or count as a Custom Event.
_Avoid_: Error, Issue, Custom Event

**Page View**:
An event representing a browser page or client-side route becoming visible to a visitor.
_Avoid_: Hit, impression

**Session**:
A bounded period of browser activity that relates a visitor's events into one journey. It ends after 30 minutes of inactivity and rotates after 24 hours of continuous activity. A Session is not the visitor's full lifecycle.
_Avoid_: Visit, replay

**Issue**:
A stable group of equivalent error events that can be investigated and resolved together.
_Avoid_: Error, exception, incident

**Fingerprint**:
A versioned stable identity that determines which error events belong to the same issue.
_Avoid_: Issue ID, hash, signature

**Issue State**:
The project-specific workflow state attached to an issue, independently of its immutable error events.
_Avoid_: Error status, event status

**Web Vital**:
A user-experience measurement captured from a real page view, such as LCP, INP, or CLS.
_Avoid_: Performance event, timing

**API Request**:
A browser-originated network operation observed in the context of a page view or session.
_Avoid_: Endpoint, trace

**Custom Event**:
A project-defined business observation with explicitly supplied properties and measurements.
_Avoid_: Track, metric event

## Diagnostic Artifacts

**Session Replay**:
A privacy-filtered reconstruction of the visible browser experience and user interactions within a session.
_Avoid_: Recording, video

**Source Map Artifact**:
A build artifact that maps generated browser code locations back to authored source locations for a release.
_Avoid_: Source map file, debug file
