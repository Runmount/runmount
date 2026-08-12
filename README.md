# Runmount

Run agents anywhere with the context and services they need.

## Install

```bash
npm install --global @runmount/cli
```

## Usage

```bash
runmount login
runmount create engineering
runmount add engineering ./AGENTS.md
runmount create project-foo --from engineering
runmount exec project-foo -- codex
```

`exec` keeps the child process in your current repository and exposes the
resolved context in `RUNMOUNT_CONTEXT_DIR`. It creates a recorded Runmount run
and removes the temporary context directory when the child exits.

## Current MVP

Profiles are versioned, private by default, and can contain files or safe
directories. Runmount excludes secrets and generated directories such as
`.env`, `.git`, `node_modules`, and `dist` from directory uploads.

```bash
# Inspect and materialize context.
runmount list
runmount show project-foo
runmount delete project-foo --yes
runmount mount project-foo

# Inspect and resume recorded runs.
runmount runs project-foo
runmount resume run_abc123 -- codex

# Create a shared workspace and a workspace-owned profile.
runmount org create acme
runmount whoami
runmount create acme/design
```

Invite teammates by email. They join automatically the next time they sign in:

```bash
runmount org invite acme teammate@company.com member
runmount org invite acme lead@company.com admin
runmount org members acme
runmount org invites acme
```

Owners and admins can change roles, revoke pending invitations, or remove a
member. Firebase UID membership commands remain available for migrations and
automation, but teams do not need them for ordinary onboarding.

```bash
runmount org member role acme <firebase-user-id> admin
runmount org member remove acme <firebase-user-id>
runmount org invite revoke acme <invite-id>
```

Third-party service authorization (`runmount auth github`, etc.) is not part of
the current release. Do not add tokens, credentials, or `.env` files to a
profile.

Run `runmount` without arguments to see all available commands.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run build
npm test
```

The Runmount service and website are maintained separately. Learn more at [runmount.com](https://runmount.com).
