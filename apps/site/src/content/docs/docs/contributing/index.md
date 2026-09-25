---
title: Contributing
description: How to propose, validate, review and ship changes to OpenRUM.
---

Contributions can be bug reports, documentation, tests or code. The best starting point is a specific problem and a small, verifiable change. This page covers collaboration and review; installation, service startup and commands live in [Local development](/docs/contributing/local-development/).

## Before you start

1. Search existing GitHub Issues and open pull requests to avoid duplicate work. For a behavior change, open or join an Issue before writing code. A small typo or broken-link fix can go straight to a pull request.
2. Discuss new features, public API or SDK contracts, event schemas, storage behavior and deployment changes in an Issue first. Describe the user problem, proposed behavior, alternatives and compatibility or rollout concerns. A pull request is not the place to discover that a feature is out of scope.
3. Read the [domain model](/docs/getting-started/domain-model/), root `CONTEXT.md` and relevant `docs/adr/` decisions before changing shared terminology or architecture. If a proposal conflicts with an existing decision, explain that conflict in the Issue.
4. Report suspected vulnerabilities privately using the [vulnerability reporting guide](/docs/self-hosting/security/vulnerability-reporting/). Do not open a public Issue or pull request containing an exploitable detail, credential or customer data.

For a bug report, include the affected version or commit, environment, minimal reproduction, expected and actual behavior, and sanitized logs or screenshots. Include a Request ID when available. For a feature request, describe the use case and acceptance criteria rather than only the proposed UI or implementation.

## Make a focused change

- Keep one pull request to one problem. Avoid unrelated refactors, generated-file churn and changes to release versions unless they are necessary to solve it.
- Update the complete contract when behavior changes: producer and consumer, schema or types, tests, user-facing copy and documentation. Do not make a Console control appear to work when its API or SDK behavior is missing.
- Add focused tests for new behavior and regressions. New database migrations must be forward-only, ordered and safe against existing data; never edit an applied migration in place. Explain compatibility and rollback limits in the pull request.
- Preserve privacy and query bounds. Never collect raw form values, passwords, authorization headers or cookies; normalize routes and API URLs before persistence. Test with synthetic or redacted data, not production telemetry.
- For UI changes, check keyboard access, visible focus, narrow screens and both themes. Provide before/after screenshots when the appearance changes.
- Update English and Simplified Chinese public pages at matching paths in the same pull request. Document shipped behavior, use Astro/Starlight components where appropriate and verify links in both languages.

## Validate before requesting review

Follow [Local development](/docs/contributing/local-development/) for setup, commands and the full validation suite. In the pull request, list the **exact commands and results** you ran; if a relevant check was not run, say why. Choose evidence that matches the change:

| Change                          | Expected evidence                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Console or SDK                  | Focused unit/type checks, a browser or example-app check for affected behavior, and screenshots for visual changes.                    |
| API, ingest, data or migrations | Focused Go tests; integration tests for dependency behavior; fresh-database migration checks when schema changes.                      |
| Public site or docs             | Both language pages, a successful site check, working direct links and readable rendering on desktop and narrow screens.               |
| Helm, release or CI             | Render/lint or workflow checks appropriate to the edit; explain rollout and rollback without using a production environment as a test. |

Browser E2E is opt-in in GitHub CI. A change to a cross-page journey may still need it; do not describe a suite as passing if you did not run it.

## Open a pull request

Use a descriptive branch and the repository pull request template. Link the related Issue and explain:

- the problem and user-visible result;
- the main implementation and any API, SDK, schema or configuration change;
- tests run, observed results and anything not verified;
- screenshots or recordings for UI changes;
- privacy, data migration, compatibility, rollout and rollback implications, or why they do not apply.

Keep the pull request reviewable and respond to feedback with concrete changes or reasoning. Maintainers may ask for a smaller scope or an Issue discussion before accepting a change. A green build does not by itself guarantee merge.

## What happens after merge

Merging into `main` starts the repository CI checks. Public-site changes also run the dedicated site checks, while the documentation website is built and published separately by Netlify from its connected branch. These systems run independently; a successful site deploy is not proof that all repository checks passed.

Merging code does **not** publish a new application image or Helm Chart, create a product release, or upgrade anyone's OpenRUM instance. Maintainers prepare versioned releases through the tagged release workflow. Operators choose when to install or upgrade a released Chart, with backups and migration compatibility checked separately. Contributors should not push release tags, publish packages or deploy to a shared environment as part of an ordinary pull request.
