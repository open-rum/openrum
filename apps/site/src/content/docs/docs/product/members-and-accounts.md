---
title: Members and accounts
description: How people get access to an Organization, what a pending account is, and how to manage your own sign-in methods.
appliesTo: Alpha
---

Access to OpenRUM has two steps: a person needs an **account**, and the account needs an **Organization role**. An account without a role can sign in but cannot see any data. This page covers both steps and the account controls each person has for themselves.

## How a new person gets access

By default OpenRUM only takes people who are invited. A person reaches an Organization in one of three ways: an administrator shares an **invitation link**, the person signs in with an external method that an Instance Owner has enabled and an administrator then adds them, or, when an Instance Owner has turned on [open registration](#open-registration), the person signs up and creates their own Organization. The first account is created during [first-run setup](/docs/getting-started/production-deployment/first-run/).

### Open registration

An Instance Owner can let anyone create an account under **System Settings → Authentication and access → Open registration**. It is off by default, and turning it on or off asks for the Owner's password again. It suits a company network where signing up should be enough to start; leave it off for an Instance that strangers can reach.

When it is on, `/register` offers two ways to sign up:

- **Email.** The person enters a user name, an email and a password, and opens the link that OpenRUM mails to confirm the address. The link works once and for 24 hours. Opening it approves the account and signs the person in, and they can create their own Organization and Projects straight away, with no administrator step. Email sign-up needs a mail server; while there is none the form is hidden and the page says so. An account whose link is never opened cannot sign in and is removed after 7 days. Sign-up never says whether an address is already registered: the page gives the same answer, and mail goes only to an address that is not registered yet.
- **An external provider.** The person signs up with a Google, GitHub or OIDC method that is enabled. If the provider gives no usable email, the person types one. OpenRUM does not verify that address, it only checks that nobody else uses it. Directory (LDAP) accounts do not register; they are created the first time someone signs in.

Passwords for sign-up, password changes and first-run setup share one rule: at least 8 characters, including an upper-case letter, a lower-case letter and a symbol.

Turning registration off stops new sign-ups. Accounts that already exist keep working. While it is off, new accounts come only from invitation links and external sign-in, and they stay pending until an administrator approves them.

### Invite people with a link

1. An Owner or Admin opens the project menu at the top left of the Console and selects **Invite members** (邀请成员). The same button is on **Members and permissions** (成员与权限).
2. Pick the role the person will have once approved: Admin, Member or Viewer. A link cannot offer Owner.
3. Choose how to hand it over:
   - **Copy link** makes the link and copies it.
   - **Send email** mails the link to the address you type. It needs a mail server, which an Instance Owner sets up under **System Settings → [Email service](/docs/self-hosting/email/)**; without one this tab is disabled. If the mail cannot be sent, the dialog still shows the link so you can copy it yourself.
4. The person opens the link. With no account they register with a name, an email and a password that follows the [password rule](#open-registration). With an account they sign in and select **Request to join**.
5. The request appears under **Members and permissions → Join requests**. An Owner or Admin picks the role, which starts as the one the link offered, and selects **Approve**, or selects **Reject**.

A link only lets its holder ask. Nothing is granted until an administrator approves, so a link that is forwarded or leaked produces extra requests to review, not access. Until then a person who registered through a link can sign in and see only a waiting page. OpenRUM does not notify the person when you approve; their waiting page checks again every 15 seconds, and someone who already had an account sees the Organization the next time they open the Console.

A link works for 7 days and for as many people as use it, until you revoke it. An Organization can hold up to 50 open links and 200 pending requests. The **Invitation links** tab lists the open links with the address each one was mailed to, so you can revoke one at once. **Resend** on a mailed link sends a new link to the same address and revokes the old one only after the new mail has gone out. A link's secret is not stored, so a link made by **Copy link** cannot be shown again; make a new one instead.

### Add someone who has already signed in

A person who signed in with an external method such as Google, GitHub, OIDC or LDAP has an account in the **pending** state. An Owner or Admin can skip the link and add them directly:

1. An Instance Owner [enables a sign-in method](/docs/getting-started/sign-in/).
2. The new person signs in once with that method.
3. An Owner or Admin opens **Members and permissions**, enters the person's email under **Existing user email**, picks a role and selects **Add member**.
4. The account becomes **approved** and the person can use the Console on the next status check.

Because the form looks up an existing account by email, adding someone who has never signed in fails. Send them a link instead, or ask them to sign in first.

A pending person can see their access status and sign out, and nothing else. They cannot read Projects or Events.

## Managing members

Open **Settings → Members and permissions** (成员与权限) and choose the Organization with the selector at the top. Everyone in the Organization can see the member list. Owners and Admins can also:

- invite people with a link and approve or reject their requests to join
- add an existing user with a role
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
| Choose a profile picture | See [Profile picture](#profile-picture) below |
| Change password | For accounts that have an OpenRUM password |
| Set an OpenRUM password | For accounts created by an external sign-in. The password follows the [password rule](#open-registration) |
| Connect a sign-in method | Adds another way to sign in to the same account |
| Disconnect a sign-in method | Allowed while another working method remains |

**Matching email addresses do not merge accounts.** If you already have an OpenRUM account and then use a new provider's login button, the sign-in is refused with an identity conflict instead of joining the account. Connect the new method from your existing account first. See [Sign in to OpenRUM](/docs/getting-started/sign-in/).

### Profile picture

Under **Settings → Profile** (个人资料) pick a picture from a batch of generated avatars, and select **Shuffle** (换一批) for another batch. A choice is saved as soon as you click it. **Restore initials** (恢复为首字母) removes the picture. It appears in the account menu, the member list, join requests and the Issue assignee picker.

You can also upload your own image, but only when an Instance Owner has configured [object storage](/docs/self-hosting/object-storage/); without it the **Upload image** (上传图片) button is disabled and says why. The Console cuts the image to the centre square and shrinks it to 256 pixels before sending it, so a PNG, JPEG, WebP or GIF of up to 10 MB is accepted. Only you and members of an Organization you share can see an uploaded picture.

Generated avatars come from the public DiceBear service, so showing one makes the viewer's browser contact `api.dicebear.com`. See [Security and privacy defaults](/docs/self-hosting/security/privacy/#profile-pictures-and-third-party-requests).

### Setting a password for an Instance role

A person who will hold an Instance Owner or Instance Admin role must have an OpenRUM password, because sensitive Instance actions ask for it again. Ask them to set it before the role is granted. The same password is used for the five-minute re-verification described in [Roles and permissions](/docs/product/roles-permissions/#instance-roles).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Adding a member says the user was not found | They have not signed in once yet, or their account is disabled. Send an invitation link instead |
| Email sign-up says to check the mail but nothing arrives | Either the address is already registered, which sign-up deliberately does not reveal, or the message is in spam. **Resend** works once a minute. Mail goes only through the Instance's [mail server](/docs/self-hosting/email/) |
| The sign-up page says registration is not open, or hides the email form | An Instance Owner has not turned on **Open registration**, or there is no mail server for the email form |
| Signing in says to confirm the email first | The account was created by email sign-up and its link has not been opened. Use **Resend verification email** on the sign-in page |
| A person signs in and only sees an access status page | The account is pending. If it came from a link, an Owner or Admin has to approve the request; otherwise they have to add the email |
| The invitation page says the link is invalid, expired or revoked | Links last 7 days and can be revoked. Ask an administrator for a new one |
| Registering through a link says the email is already registered | The person has an account. They should sign in from the same page and select **Request to join** |
| The default avatars show only initials | The browser cannot reach `api.dicebear.com`. Shuffle to retry, keep the initials, or upload a picture |
| **Upload image** is disabled | Object storage is not configured. An Instance Owner sets it up under **System Settings → Object storage** |
| The **Send email** tab is disabled | No mail server is configured. An Instance Owner sets one up under **System Settings → Email service**, or copy the link instead |
| Signing in with a provider reports an identity conflict | An account with that email already exists. Sign in the old way and connect the provider under **Profile** |
| The member list is read-only | Your role is Member or Viewer; ask an Owner or Admin |
| An Admin cannot change a member's role to Owner | By design; only an Owner can grant or change Owner |
