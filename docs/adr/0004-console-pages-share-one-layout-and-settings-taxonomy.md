---
status: accepted
---

# Console pages share one layout and one settings taxonomy

The Console had six page-width rules, three title scales, several unrelated
header anatomies, and three settings-like entries in the main navigation. We
decided that every authenticated Console page uses one composable page layout:
a controlled `fluid`, `wide`, or `narrow` main-column width; a 208px contextual rail on
desktop; and a main column with fixed slots for header, optional description,
tabs, a freely composed filter bar, and content. The filter bar standardises
placement, wrapping, and responsive behaviour but never owns a fixed set of
filters. Time belongs there when a page needs it; data-page filter state remains
URL-backed. Loading, error, and empty states replace content without replacing
the page frame.

The main sidebar contains one Project Settings entry. Integration, releases,
usage, quota, data governance, and development-only data
generation are grouped inside its contextual rail. Personal and Organization
settings, notification channels, and Instance Settings live in the account
menu; Instance Settings are shown only to Instance Administrators. This keeps
the product's primary observation areas visible without presenting Project,
Organization, and Instance configuration as peers.

## Considered options

**One maximum width for every page.** Rejected because chart workspaces need the
available canvas while forms become hard to scan at the same width. Controlled
width variants preserve consistency without pretending the tasks are identical.

**A fixed global filter schema.** Rejected because an issue list, a performance
workspace, and an event explorer do not share the same query dimensions. The
layout owns the filter surface; each page owns its filter controls and query
model.

**Keeping every settings scope in the main sidebar.** Rejected because it made
Project Settings, Organization membership, and Instance operations look
interchangeable and crowded out the daily monitoring areas.

## Consequences

Desktop pages render the contextual rail only when they have contextual
navigation; pages without it use the full content width. Below 1024px an enabled
rail moves into a Drawer. Filter controls may wrap on desktop; secondary
controls move into a Drawer on narrow screens. The team deliberately chose
documentation and review rather than an automated rule forbidding page-level
layout classes.

## Analysis filter extension (2026-09-12)

For pages with multiple dimensions, a shared `AnalysisFilterSidebar` may sit on
the right of the content instead of crowding the horizontal filter bar. It owns
draft/apply controls, active chips, collapse preference, and the mobile Sheet;
pages still own their supported dimensions and URL/query model. This is not the
left contextual navigation rail. Time and environment continue to use the
shared app status bar and project switcher respectively. Performance and Issues
are the first consumers; unsupported API dimensions must not be offered.
