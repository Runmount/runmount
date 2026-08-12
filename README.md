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
runmount mount project-foo

# Inspect and resume recorded runs.
runmount runs project-foo
runmount resume run_abc123 -- codex

# Create a shared workspace and a workspace-owned profile.
runmount org create acme
runmount whoami
runmount create acme/design
```

Workspace owners and admins can add a member by Firebase user ID:

```bash
runmount org member add acme <firebase-user-id> member
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
