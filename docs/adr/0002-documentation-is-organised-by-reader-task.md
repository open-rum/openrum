---
status: accepted
---

# Documentation is organised by reader task, and states what does not work

The documentation had grown nine sidebar groups, a URL hierarchy that no longer
matched them, and a habit of describing capabilities in the voice of a finished
product. A reader arriving with a job — deploy this, instrument that, work out
why an error has no stack trace — had to reconstruct the map before starting. We
decided on six top-level topics that name reader tasks, a URL hierarchy that
follows them exactly, and a rule that a page must say what a capability does not
do wherever that is load-bearing.

The six topics are Get started, SDK, Product, Self-hosting, Reference and
Contributing. The header exposes them as tabs, and the sidebar shows only the
active one, so the visible navigation is a single section rather than every page
in the project.

## Considered options

**Keeping the nine groups and only restyling them.** Rejected because the
problem was the count and the naming, not the appearance. Nine groups do not fit
a header, and a sidebar listing all of them shows a reader ninety links when
about eight are relevant.

**Keeping the old URLs and only changing the sidebar.** Rejected because it
leaves two classifications running at once. `operations/` and `security/` were
top-level URL namespaces left over from the old grouping; retaining them means
the URL says one thing and the navigation says another, and the two are then
free to drift. They were folded into `self-hosting/` with redirects, and the
redirects are covered by end-to-end tests rather than trusted.

**Deriving navigation from the file tree.** Rejected because file layout follows
the URL hierarchy, which follows the taxonomy — deriving the taxonomy from it
would make the ordering implicit and untranslatable. The topics are declared in
`astro.config.mjs` with their translations, and the header, sidebar and
breadcrumbs all read that one declaration through `src/lib/docsTopics.ts`.

**Publishing everything the repository knows.** Rejected for
`contributing/system-administration`, which described an unbuilt administrative
surface. It stays in the repository as an internal RFC. A published page is a
promise; an RFC is not.

## Consequences

**Pages state their limits explicitly, including the unflattering ones.** The
browser SDK page carries a support matrix that says server-side rendering drops
Events silently, that route patterns are not recorded so a dynamic route
produces one Route per URL, that a rejected write key stops the page without
logging, that hash routing is not captured, and that there is no CDN build
because the package has no IIFE or UMD output. Each of those came out of reading
the source rather than from a feature list. This costs some polish and buys the
only thing documentation for an unfinished product can offer: a reader who is
not surprised later. `appliesTo` frontmatter pins every such claim to a version.

**Capacity numbers are recorded as absent rather than estimated.** The capacity
page carries a table of the measurements it will be filled in from, each marked
not measured, with no evidence. Quoting a plausible figure would be indebted to
nothing, and a reader cannot tell an estimate from a measurement once it is in a
table.

**Reference pages are generated and gated, not written.** The environment
variables, Event schema, Helm values and SDK options pages are produced by
`scripts/docs/generate-reference.mjs` from `internal/config/config.go`, the
Envelope JSON Schema, `values.yaml` and the SDK's `ClientOptions`.
`pnpm docs:check` fails when a generated page is stale, and the SDK generator
additionally fails when `ClientOptions` gains an option that has no description
— so an undocumented option cannot ship. Defaults that the type declaration
cannot express are read from source too, which is why the sample rates and the
flush interval in the table cannot drift from the code.

**Translation covers the pages where being wrong is expensive.** Chinese
versions exist for the entry points, the SDK line and the architecture page, and
the configuration reference is generated in both languages. The rest falls back
to English by design; a stale translation of a reference table is worse than an
English one.
