# Phase 1 review — Identity & Project Control Plane

Reviewed: 2026-09-02

## Scope

Tasks 011–019: control-plane schema, instance bootstrap, local authentication,
server sessions and CSRF, organization/project RBAC and APIs, write-key
lifecycle, protected application shell, project onboarding, and member settings.
GitHub review was unavailable because this repository has no configured remote;
this document records the equivalent local review required by the roadmap.

## Verification evidence

- `pnpm run check` passes formatting, ESLint, TypeScript, workspace and Go unit
  tests, protocol generation/fixtures, production builds, and SDK size budget.
- golangci-lint v2.12.2 reports zero issues with `.golangci.yml`.
- PostgreSQL integration tests pass five consecutive runs with destructive test
  packages serialized against the dedicated `openrum_test` database.
- Twenty concurrent bootstrap requests create exactly one owner, organization,
  membership, audit record, and authenticated session.
- Cross-organization resource access returns not-found, CSRF is enforced on
  mutations, and the last-owner invariant remains valid under concurrency.
- Raw write keys are returned only at creation or rotation; PostgreSQL stores
  only their prefix and SHA-256 hash. Rotated and revoked keys fail validation.
- Browser verification covered bootstrap, login, logout, expired-session
  redirect, safe same-origin return paths, and rejection of external return URLs.
- Browser role verification covered Owner, Admin, Member, and Viewer behavior
  across member management, project creation, and project key settings.
- Desktop and 390 px mobile visual checks confirm readable auth, member, and
  project surfaces without horizontal overflow.

## Findings resolved during review

- Made bootstrap user creation and initial authenticated session creation one
  transaction so setup cannot succeed without a usable session.
- Added a guard that refuses destructive integration tests unless PostgreSQL is
  local and the database name ends in `_test`.
- Added transactional authorization checks inside repositories in addition to
  handler checks, preventing time-of-check/time-of-use permission races.
- Serialized membership mutations and locked owner rows to preserve the
  last-owner invariant under concurrent updates and deletes.
- Canonicalized project origin validation and rejected origins containing paths,
  queries, fragments, or credentials.
- Changed failed logout handling to keep the current page and session state
  instead of redirecting into a possible authenticated-login loop.
- Reworked the member table into mobile cards and added explicit query-error
  states to project and membership settings.

## Accepted follow-up risks

- Local password authentication is production-capable for the initial release;
  OIDC/SSO provisioning and group mapping remain scheduled for Phase 10.
- The application shell currently selects the first organization and project.
  Persistent multi-organization selection belongs with later settings and
  dashboard state work.
- Integration tests share one destructive database and therefore must run with
  `go test -p=1`; isolated per-package databases can be introduced when CI adds
  parallel integration workers.

## Decision

Phase 1 is accepted for local continuation. Push, hosted CI execution, and a
GitHub PR remain unavailable until a remote is configured.
