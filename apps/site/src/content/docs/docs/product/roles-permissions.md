---
title: Roles and permissions
description: What Owner, Admin, Member and Viewer can do inside an Organization, and what Instance Owner and Instance Admin can do for the whole Instance.
appliesTo: Alpha
---

OpenRUM checks permissions on the server for every request, so hiding a button in the Console is never the only protection. A role is attached to an **Organization** and applies to every Project in it. Instance roles are separate; see [Organizations, Projects and roles](/docs/product/organizations-and-projects/) for how the scopes relate.

## Organization roles

| Role | In short |
| --- | --- |
| Owner | Full control of the Organization, including deleting Projects and managing other Owners |
| Admin | Configures Projects and notification channels and manages members, except Owners |
| Member | Works with the data: resolves Issues, manages Releases and alert rules |
| Viewer | Read-only access to every Project in the Organization |

### What each role can do

| Action | Owner | Admin | Member | Viewer |
| --- | :-: | :-: | :-: | :-: |
| View Projects, Events, Issues, Sessions, dashboards, Releases and alert rules | Yes | Yes | Yes | Yes |
| Change an Issue's status or assignee | Yes | Yes | Yes | No |
| Create and delete Releases and manage their Source Map Artifacts | Yes | Yes | Yes | No |
| Send a test Event | Yes | Yes | Yes | No |
| Create, edit and delete alert rules | Yes | Yes | Yes | No |
| Manage notification channels | Yes | Yes | No | No |
| Create a Project and edit its settings (name, Environments, allowed Origins, sampling, rate limit, retention) | Yes | Yes | No | No |
| Manage DSN keys and Upload Tokens | Yes | Yes | No | No |
| Manage inbound filters and processing rules | Yes | Yes | No | No |
| Add members and change or remove Viewers, Members and Admins | Yes | Yes | No | No |
| Grant, change or remove an Owner | Yes | No | No | No |
| Delete a Project or purge its data | Yes | No | No | No |

Two details are worth knowing:

- **Channels are separate from rules.** A notification channel holds delivery secrets such as a webhook URL, so Members can decide which alert rules exist but not where alerts are sent. See [Alerts](/docs/product/alerts/).
- **Keys are hidden from Members.** The Project's DSN keys are only listed for Owner and Admin. CI pipelines that publish Releases use an [Upload Token](/docs/sdk/source-maps/) instead of a Console session.

Every signed-in user whose access is approved can create a new Organization and becomes its Owner. That does not give them access to anyone else's Organization.

### Guardrails on members

- An Organization must keep at least one Owner. Demoting or removing the last Owner is refused.
- Admins cannot create Owners, change an Owner's role or remove an Owner. Only an Owner can.
- Member changes are written to the Organization's audit log.

## Instance roles

Instance roles control installation-wide settings. They are independent of Organization roles: an Instance Owner who is not a member of an Organization cannot open its Projects.

| Action | Instance Owner | Instance Admin |
| --- | :-: | :-: |
| View the Instance overview, configuration, maintenance jobs and audit log | Yes | Yes |
| Change Instance configuration values | Yes | Yes |
| Test the object storage connection | Yes | Yes |
| Preview a retention change or an emergency cleanup | Yes | Yes |
| Save managed object storage settings | Yes | No |
| Start a retention job or an emergency cleanup that deletes data | Yes | No |
| Add, change or remove sign-in providers | Yes | No |
| Manage Instance members | Yes | No |

Changes to Instance settings, and anything that deletes data, ask the person to re-enter their OpenRUM password. The verification lasts five minutes. A user who holds an Instance role must therefore have a local OpenRUM password, even if they normally sign in through an external provider.

The Instance always keeps at least one Instance Owner. The person who completes first-run setup is the first one.

## Who can see what in the Console

The Console follows the same rules. People without an Instance role do not see **System settings** at all, and controls that your role cannot use are shown read-only or left out. For the pages that cover the data itself, see [Discover and investigate](/docs/product/investigation/) and [Alerts](/docs/product/alerts/).
