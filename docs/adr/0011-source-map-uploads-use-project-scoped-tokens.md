# 0011. Source Map uploads use project-scoped tokens

Date: 2026-09-30

Status: Accepted

## Context

The Vite plugin and CLI authenticated uploads with a Console session cookie and its CSRF
token. To use them in CI, someone had to sign in, copy both values out of the browser and
store them as pipeline secrets. That credential carried the full rights of that person across
every Organization and Project they could reach, expired with the session, and could not be
revoked without signing the person out. A team could not tell which pipeline had used it.

The upload flow was also fragile for ordinary CI use. Creating an existing Release returned
409, so re-running a build failed. A map with a name already present could not be replaced
after a failed upload. Maps uploaded after the errors arrived never mapped those errors, and
a transient storage read failure was saved as a permanent `invalid_map` result.

## Decision

- **Project upload tokens.** Owners and Admins create named tokens for one Project in
  **Settings → Project → Onboarding**. The secret is `orut_` plus 32 random bytes in
  base64url, shown once. Only its SHA-256 hash and a short prefix are stored, following the
  pattern used for project keys. The token list shows creator and last use, and a token can
  be revoked at any time.
- **Narrow rights.** `Authorization: Bearer orut_…` is accepted only to create and list
  Releases, request an upload grant, complete an Artifact and list Artifacts, and only for the
  token's own Project. It needs no CSRF token because it is not a browser credential. Delete
  endpoints and every other API reject it.
- **Idempotent uploads.** Creating a Release for an existing version and dist returns it. A
  ready Artifact with the same name and SHA-256 is skipped; a different SHA-256 fails with
  `ARTIFACT_EXISTS` unless the uploader explicitly asks to replace it. Pending or failed
  Artifacts are always replaced.
- **Remapping.** When an Artifact becomes ready, the Worker remaps errors from the last seven
  days for that Release and dist that were not fully mapped. Storage read failures are
  retried rather than saved.
- The session and CSRF options stay in the plugin as a deprecated fallback.

## Consequences

- CI stores one revocable, Project-scoped secret instead of a person's session, and leaking it
  exposes only uploads for one Project.
- Re-running a pipeline for the same Release is safe, and a changed build under a reused
  Release version fails loudly instead of silently mixing maps.
- Uploading maps after a deployment still maps recent errors, at the cost of a remap queue
  table and extra Worker reads.
- The API has a second authentication path for a small set of routes, which middleware and
  tests must keep from widening.
- Tokens are Project-scoped only; an Organization-wide or Instance-wide upload token would
  need a new decision.
