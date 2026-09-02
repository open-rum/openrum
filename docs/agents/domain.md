# Domain Docs

This repository uses a single-context domain layout.

## Before exploring, read these

- `CONTEXT.md` at the repository root, when present.
- Relevant ADRs under `docs/adr/`.

If these files do not exist, proceed silently. Domain documentation is created lazily when terminology or architectural decisions are resolved.

## Expected layout

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── ...
```

## Consumer rules

Use terminology defined in `CONTEXT.md` consistently. Do not drift to synonyms the glossary explicitly avoids.

If work contradicts an existing ADR, surface the conflict explicitly rather than silently overriding the decision.
