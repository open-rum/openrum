# Issue tracker: GitHub

Issues and specs live in GitHub Issues. Use the `gh` CLI for all operations.

The repository remote must be configured before issue operations.

## Conventions

- **Create:** `gh issue create --title "..." --body "..."`
- **Read:** `gh issue view <number> --comments`
- **List:** `gh issue list --state open`
- **Comment:** `gh issue comment <number> --body "..."`
- **Label:** `gh issue edit <number> --add-label "..."`
- **Close:** `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill conventions

- “Publish to the issue tracker” means creating a GitHub issue.
- “Fetch the relevant ticket” means running `gh issue view <number> --comments`.
- A wayfinder map uses label `wayfinder:map`.
- Child tickets use `wayfinder:<type>`.
- Prefer GitHub sub-issues and native issue dependencies when available.
