---
title: Troubleshooting
description: Diagnose local startup, missing Events, login and Source Map problems.
appliesTo: Alpha
---

## Local Compose will not become healthy

1. Confirm Docker and Compose v2 are available and host ports are free: `4173`, `5433`, `8123`, `9000`, `9092`, `6379`.
2. Inspect service status:

```sh
docker compose -f deploy/compose/docker-compose.yml ps
docker compose -f deploy/compose/docker-compose.yml logs --tail=100 api ingest consumer worker web
```

3. Override conflicting ports in `deploy/compose/.env`.
4. Recreate named volumes only when you intend to wipe local Demo data:

```sh
docker compose -f deploy/compose/docker-compose.yml down -v
```

## Console loads but login fails

- Use exactly `http://127.0.0.1:4173`, matching `PUBLIC_BASE_URL`.
- Confirm API readiness: `curl --fail http://127.0.0.1:4173/health/ready`.
- Demo credentials are `demo@openrum.local` / `OpenRUM-demo-2026!` for local development only, and exist only after `pnpm openrum seed`.

## Events do not appear

1. Confirm the Browser SDK `dsn` and the Project's allowed Origin.
2. Check ingest logs and Origin allowlist for the Project key.
3. Confirm Kafka, Consumer and ClickHouse are healthy; if you use the demo dataset, wait for `pnpm openrum seed` to finish.
4. Open **Events** with a wide time range, then inspect **Sessions** for the same `session_id`.

## Investigation path incomplete

| Symptom                         | Likely cause                                                    | Next step                                               |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Behavior charts empty           | Demo not seeded, or ClickHouse unhealthy                        | Run `pnpm openrum seed`, then check Consumer/ClickHouse |
| Session without errors          | Selected Session has no error Events                            | Filter Sessions with errors on `/checkout` in Demo      |
| Issue missing Source Map frames | Object storage not configured, or no Artifact matches the frame | See [Source Map upload fails](#source-map-upload-fails) |
| API panel empty                 | No fetch/XHR captured or sampling disabled                      | Trigger traffic from the React example                  |

## Source Map upload fails

Object storage is optional. Configure OSS or an S3-compatible Bucket only when mapped frames are required, then follow [Source Maps](/docs/sdk/source-maps/) and [Object storage](/docs/self-hosting/object-storage/).

The plugin and CLI print a line per failed file with the API error code and a Request ID. Look the code up below; search API and Worker logs for the Request ID when you need the server-side detail.

| Code                                  | Meaning                                                                                                                                                                 | What to do                                                                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORAGE_NOT_CONFIGURED` (503) | No object storage is configured on the Instance. The plugin stops uploading the remaining files.                                                                        | An Instance administrator configures OSS or S3 through environment variables or **Settings → Instance → Object storage**; see [Object storage](/docs/self-hosting/object-storage/).                                                                                 |
| `OBJECT_STORAGE_UNAVAILABLE` (503)    | Storage is configured but the live client cannot use it: wrong credentials, a deleted Bucket, a network or DNS failure, or a provider outage. The plugin retries twice. | Check API logs and the provider status. Console-managed settings reach every API and Worker replica within about 30 seconds, so wait that long after a change before retrying. Follow the [Object storage runbook](/docs/self-hosting/object-storage/) for outages. |
| `ARTIFACT_TOO_LARGE` (400)            | A map is larger than 64 MiB. The plugin rejects such files before upload.                                                                                               | Split the bundle, for example with `build.rollupOptions.output.manualChunks`, so each map is smaller.                                                                                                                                                               |
| `ARTIFACT_EXISTS` (409)               | The Release already has a ready map with that name but different contents, usually because a changed build reused the Release version.                                  | Give the changed build a new Release. To overwrite deliberately, set `replace: true` or pass `--replace`. Identical re-uploads are skipped and never raise this error.                                                                                              |
| `ARTIFACT_MISMATCH` (422)             | The stored object's size or SHA-256 differs from what the plugin declared, for example because a proxy altered the body or the upload was truncated.                    | Run the upload again. If it repeats, check proxies between the CI runner and object storage and the Bucket's transformation or compression settings.                                                                                                                |
| `INVALID_UPLOAD_TOKEN` (401)          | The token is malformed, unknown or revoked.                                                                                                                             | Create a new token under **Settings → Project → Onboarding → Source Map upload tokens** and update the `OPENRUM_UPLOAD_TOKEN` CI secret.                                                                                                                            |
| `NOT_FOUND` (404)                     | The Project ID is wrong, or the token belongs to a different Project.                                                                                                   | Use the Project ID of the Project that issued the token.                                                                                                                                                                                                            |

### Upload succeeds but frames stay unmapped

Open the error from **Issues**. Each unmapped frame shows a reason:

- **`missing_artifact`** is almost always a naming mismatch. The Artifact name must equal the script URL path without scheme, host, query or leading `/`, plus `.map`. Compare the frame URL with the names listed on the Release in **Releases**. If the site is served below a sub-path or CDN prefix, set `urlPrefix` so the names include it. Use the match tester on the Releases page to check a single frame.
- **`missing_release`** means the Event has no `release`. Set `release` in the SDK `init()`.
- **`ambiguous_artifact`** or maps that exist for another Release: the SDK `release` and `dist` must exactly equal the values the plugin used.

Errors from the last 7 days are remapped automatically once a missing Artifact becomes ready, so a fixed upload also fixes recent Events.

## Still stuck

- [Capacity planning](/docs/self-hosting/capacity/)
- Dependency runbooks under **Operations**
- [Threat model](/docs/self-hosting/security/threat-model/) before exposing an Instance publicly
- Open a repository Issue with Compose status, Request IDs and redacted logs
