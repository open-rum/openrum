---
title: Members and accounts
description: How people get access to an Organization, what a pending account is, and how to manage your own sign-in methods.
appliesTo: Alpha
---

Access to OpenRUM has two steps: a person needs an **account**, and the account needs an **Organization role**. An account without a role can sign in but cannot see any data. This page covers both steps and the account controls each person has for themselves.

## How a new person gets access

OpenRUM does not email invitations or let people register themselves. The first account is created during [first-run setup](/docs/getting-started/production-deployment/first-run/). Every other person is added in this order:

1. An Instance Owner [enables a sign-in method](/docs/getting-started/sign-in/) such as Google, GitHub, OIDC or LDAP.
2. The new person signs in once with that method. This creates an account in the **pending** state.
3. An Owner or Admin of the Organization opens **Members and permissions** (成员与权限), enters the person's email under **Existing user email**, picks a role and selects **Add member**.
4. The account becomes **approved** and the person can use the Console on the next status check. No further action is needed from them.

Because the form looks up an existing account by email, adding someone who has never signed in fails. Ask them to sign in first, then add them.

A pending person can see their access status and sign out, and nothing else. They cannot read Projects or Events.

## Managing members

Open **Settings → Members and permissions** (成员与权限) and choose the Organization with the selector at the top. Everyone in the Organization can see the member list. Owners and Admins can also:

- add a member with a role
- change a member's role
- remove a member

The roles you can offer depend on yours. Admins can assign Admin, Member and Viewer, but only Owners can assign, change or remove an Owner. The last Owner of an Organization cannot be demoted or removed. What each role allows is in [Roles and permissions](/docs/product/roles-permissions/).

Removing a member ends their access to the Organization and all its Projects. It does not delete their account, and they keep access to any other Organization they belong to.

### Giving someone access to only some Projects

Roles apply to a whole Organization. To limit a person to one product, put that product in its own Organization and add them only there. See [Organizations, Projects and roles](/docs/product/organizations-and-projects/).

## Your own account

Everyone manages their own sign-in under **Settings → Profile** (个人资料):

| Task | Notes |
| --- | --- |
| Change password | For accounts that have an OpenRUM password |
| Set an OpenRUM password | For accounts created by an external sign-in. The password is at least 12 characters |
| Connect a sign-in method | Adds another way to sign in to the same account |
| Disconnect a sign-in method | Allowed while another working method remains |

**Matching email addresses do not merge accounts.** If you already have an OpenRUM account and then use a new provider's login button, the sign-in is refused with an identity conflict instead of joining the account. Connect the new method from your existing account first. See [Sign in to OpenRUM](/docs/getting-started/sign-in/).

### Setting a password for an Instance role

A person who will hold an Instance Owner or Instance Admin role must have an OpenRUM password, because sensitive Instance actions ask for it again. Ask them to set it before the role is granted. The same password is used for the five-minute re-verification described in [Roles and permissions](/docs/product/roles-permissions/#instance-roles).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Adding a member says the user was not found | They have not signed in once yet, or their account is disabled |
| A person signs in and only sees an access status page | The account is pending. An Organization Owner or Admin has to add their email |
| Signing in with a provider reports an identity conflict | An account with that email already exists. Sign in the old way and connect the provider under **Profile** |
| The member list is read-only | Your role is Member or Viewer; ask an Owner or Admin |
| An Admin cannot change a member's role to Owner | By design; only an Owner can grant or change Owner |
