# Phase 8 review — System Administration & Data Governance

## Scope

Reviewed TASK-086 through TASK-094 against `docs/system-administration.md`, the Instance terminology in `CONTEXT.md`, and the threat boundaries in `docs/security/threat-model.md`.

## Outcome

- Instance RBAC protects all `/api/v1/admin/*` routes; direct non-instance access is covered by E2E.
- Data lifecycle exposes bounded raw, aggregate and Source Map policies, project impact preview and observable background cleanup state.
- Dangerous cleanup validates the current password. Instance member mutations, instance-setting changes and managed-storage rotation independently require a session-scoped elevation no older than five minutes. Preview tokens remain actor-bound, single-use and hashed at rest.
- Instance audit records Request ID, actor, resource and a body-free change summary. Secret, password and preview-token values are excluded by construction.
- Object storage remains optional. Deployment-managed RAM/IAM roles and Secrets are preferred; the opt-in managed path requires an external 32-byte master key, probes before committing an AEAD envelope and swaps the live storage router only after the database write succeeds.
- Compose starts without object storage and all core services stay healthy. Helm values expose the same opt-in and reference an existing Kubernetes Secret.

## Verification

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test`
- `go test ./...`
- `pnpm run test:integration`
- `go vet ./...`
- `pnpm exec playwright test tests/e2e/admin.spec.ts`
- Managed-storage handler tests prove a failed probe cannot persist or swap credentials, while a successful probe persists before the live switch and immediately exposes only a masked identity. The isolated PostgreSQL integration test proves encrypted credentials survive repository reconstruction, can be decrypted during a key transition and advance both key ID and record version when rewritten.
- `docker compose -f deploy/compose/docker-compose.yml up -d --build migrate api worker web`
- PostgreSQL contains `instance_audit_logs`, `instance_secrets`, and `sessions.elevated_at`; API, Ingest, Worker and dependencies report healthy.

`helm lint` could not be executed locally because the Helm binary is not installed. The templates keep all master-key material in `secretKeyRef`; CI/deployment environments should retain Helm lint as a release gate.

## Residual risk

The controlled self-host pilot sign-off in TASK-076 is external evidence and remains open. Managed credential rotation is intentionally disabled in the default local stack, so a real provider matrix still belongs in deployment acceptance rather than unit tests.
