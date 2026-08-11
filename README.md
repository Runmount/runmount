# Runmount

Run agents anywhere with the context and services they need.

## Install

```bash
npm install --global @runmount/cli
```

## Usage

```bash
runmount login
runmount create project-foo
runmount add project-foo ./AGENTS.md
runmount exec project-foo -- codex
```

Run `runmount` without arguments to see all available commands.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run build
npm test
```

The Runmount service and website are maintained separately. Learn more at [runmount.com](https://runmount.com).
