# 0009. Alert channels use a kind registry, starting with native Feishu

Date: 2026-09-29

Status: Accepted

## Context

Alerts could only be sent through a generic signed webhook, and in practice were not sent
at all: the worker had no delivery wired in. Teams mostly work in group chats. Pasting a
Feishu or DingTalk bot address into the generic webhook does not work, because each
provider expects its own message format, so every team would need a relay service of its
own. The design notes had deliberately avoided native IM integrations to keep the scope
small.

## Decision

Notification channels are typed by a registry in `internal/notify/kinds.go`. Each kind owns
its config validation, its write-only secret fields and its notifier. Feishu is the first
native kind: interactive cards with a diagnosis link, optional signature verification and
host allowlisting for `open.feishu.cn` and `open.larksuite.com`. The generic webhook stays
for everything else.

Other providers (DingTalk, WeCom, Slack, email) are listed in the Console as coming soon and
added one at a time through the same registry, migration constraint and docs page.

Deliveries are logged per channel in `alert_deliveries` with short fixed error codes, so the
Console can say why a message did not arrive without storing provider responses.

## Consequences

- Each native kind is a small, testable unit, and adding one follows a checklist
  (`docs/agents/alerts.md`).
- Native kinds carry provider-specific failure modes (signatures, keywords, rate limits)
  that the Console must explain.
- The worker now needs the Instance master key and public base URL, like the API.
