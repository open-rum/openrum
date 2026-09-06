---
status: accepted
---

# The openrum CLI orchestrates local development

Local development runs a mix of containers and host processes, and Compose can
only speak for the containers. Bringing the stack up means waiting for
ClickHouse and Kafka to be genuinely ready rather than merely started,
supervising a host Go API and a host Vite server so they survive the terminal
that launched them, deriving the host environment from Compose's `.env` so the
two halves agree, and answering "is everything up?" in one place. We decided to
put that orchestration in a Go program at `cmd/openrum`, wrapped as
`pnpm openrum`, with two explicit modes: `up` runs everything in containers, and
`dev` runs the API and console on the host against containerised infrastructure.

## Considered options

**Shell aliases or pnpm scripts.** Rejected because the work is not command
shortening. Readiness waits, process supervision, port-conflict attribution and
aggregated status are all state that a script would have to invent anyway, and
they are the reason the tool exists.

**A single `start` that infers the mode.** Rejected because the two modes differ
in which processes you are actually running and debugging. Guessing wrong is
expensive and silent, so the mode is named at the call site.

**Keeping separate console ports for the two modes** (4173 for containers, 5173
for Vite). Rejected in favour of one console URL on `CONSOLE_PORT` (4173) for
both modes; see the consequence below.

## Consequences

**The two modes are mutually exclusive, deliberately.** Vite listens on 4173
with `strictPort`, and `dev` does not start the `web` container, so whichever
mode you are in owns the same URL. Earlier documentation promised the two could
coexist; that promise is withdrawn on purpose. Coexistence means two API
instances and, historically, two consumers against one database — a duplicated
Kafka consumer left running on the host once split the partitions with its
containerised twin and wrote half the events with an unresolved country, which
cost a long debugging session. Making the mode a choice the CLI enforces turns
that silent ambiguity into an error message.

**`dev` sends ingest traffic straight to the published ingest port**, and ingest
believes the country header from any peer when `APP_ENV` is `development`. The
two go together. Routing through the nginx container had been the way country
resolution worked, because only an in-network hop lands inside the private
ranges the compose file trusts; measured from the host, a request to a published
port arrives from `172.67.72.165` on Docker Desktop and from the bridge gateway
on Linux, so the first resolves nothing and the second resolves everything.
Trust decided by address would therefore work for some contributors and not
others, and once the console moved to a single port there was no free port for
Vite to reach nginx on anyway. Bounding the relaxation by `APP_ENV` keeps the
committed environment file production-shaped, and a forged header reaches
analytics and nothing else because the rate-limit identity stays bound to the
socket peer address. Production fidelity for the nginx hop belongs to `up`,
which runs the real thing.

**Scope excludes anything that is not a service.** The CLI does not proxy pnpm
scripts, and it does not start or report `apps/site`, which has no
infrastructure dependencies and ships through its own static build. Runtime
state (PIDs, logs) lives in an ignored `.openrum/` directory at the repository
root.
