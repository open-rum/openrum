---
status: accepted
---

# Emergency storage recovery drops complete old partitions

Normal retention changes use bounded ClickHouse mutations because a new policy
may cut through the middle of a month. Mutations rewrite parts and can require
additional merge space, so they are not a reliable recovery mechanism after the
storage-pressure guard has already hard-stopped Ingest.

Emergency recovery is therefore a separate Instance operation. When ClickHouse
is at least 85% used, the API reads active part metadata and builds one
recommended plan from the oldest complete Project/month partitions. It selects
whole groups until the projected usage is at most 85%, or exhausts the safe
candidates. The month must have ended at least 24 hours earlier, and any group
containing data from the most recent 24 hours is excluded. A quiet but still-open
current month is never considered complete.

The Console presents the current usage, estimated release, projected result and
affected Project/month groups in ordinary product language. Execution requires
an Instance Owner, password confirmation, an opaque single-use preview
token, and explicit confirmation. One global recovery job runs at a time. The
Worker drops only allowlisted partition IDs from known local ClickHouse tables,
records progress and audit entries, and treats an already-absent partition as a
completed idempotent step.

This feature deliberately does not delete ClickHouse files, Kafka topics, Docker
volumes or recent partial months. If safe partitions cannot return storage to
the target, the Console says that expansion is still required. The existing
storage monitor remains the authority for reopening Ingest: recovery work never
bypasses the latch, and writes resume only after a successful capacity probe
reports usage below 90%.
