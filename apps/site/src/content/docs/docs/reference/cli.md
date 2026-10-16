---
title: CLI
description: The openrum command from @openrum/cli, its commands, options, environment variables and exit codes.
appliesTo: "@openrum/cli 0.1.0"
---

`@openrum/cli` installs the `openrum` command. It uploads Source Maps from your own build, and inside a checkout of the OpenRUM repository it is also the front door to the local development stack. It needs Node.js 20 or later.

```sh
pnpm add -D @openrum/cli
pnpm exec openrum --help
```

`npm install --save-dev @openrum/cli` and `yarn add -D @openrum/cli` work the same way, and `npm install --global @openrum/cli` puts `openrum` on your path.

## Commands

```text
openrum <command> [options]
```

| Command | What it does |
| --- | --- |
| `openrum sourcemaps upload` | Upload hidden Source Maps from a build to an OpenRUM Release |
| `openrum help` | Print the command list |
| `openrum --version` | Print the package version (`-v` and `version` do the same) |
| `openrum dev`, `up`, `status`, `logs`, `restart`, `seed`, `stop`, `down`, `reset` | Manage the local development stack, only inside a checkout of the repository |

## `openrum sourcemaps upload`

Reads every `.map` file under the build output, creates (or reuses) the Release, uploads the maps and removes them, with their `sourceMappingURL` comments, from the build. It does the same as the Vite plugin; [Source Maps](/docs/sdk/source-maps/) explains the flow, the Release matching and why a frame might not map.

```sh
OPENRUM_BASE_URL=https://rum.example.com \
OPENRUM_PROJECT_ID=00000000-0000-4000-8000-000000000000 \
OPENRUM_RELEASE=storefront@1.8.0 \
OPENRUM_UPLOAD_TOKEN=orut_... \
pnpm exec openrum sourcemaps upload --out-dir dist --url-prefix static/app/
```

Every value comes from a flag or an environment variable, and **a flag wins over the environment**. Run `openrum sourcemaps upload --help` for the same table in the terminal.

| Flag | Environment variable | Default | Notes |
| --- | --- | --- | --- |
| `--base-url` | `OPENRUM_BASE_URL` | none | OpenRUM API origin, for example `https://rum.example.com`. Required |
| `--project-id` | `OPENRUM_PROJECT_ID` | none | Required |
| `--release` | `OPENRUM_RELEASE` | none | Must equal the SDK's `release`. Required |
| `--dist` | `OPENRUM_DIST` | none | When used, must equal the SDK's `dist` |
| `--commit-sha` | `OPENRUM_COMMIT_SHA` | none | Recorded on the Release |
| `--out-dir` | `OPENRUM_OUT_DIR` | `dist` | The build output that is scanned for `.map` files |
| `--url-prefix` | `OPENRUM_URL_PREFIX` | empty | URL path placed before each file's path, for example `static/app/`. See [Artifact names](/docs/sdk/source-maps/#artifact-names-and-urlprefix) |
| `--replace` | `OPENRUM_REPLACE=true` | off | Overwrite an uploaded map with the same name but different contents |
| `--token` | `OPENRUM_UPLOAD_TOKEN` | none | A [Source Map upload token](/docs/sdk/source-maps/#create-an-upload-token) |
| `--help` | none | | Print the options |

Prefer the environment variable for the token, so it stays out of process listings and shell history. Parallel uploads and retries are fixed at 4 and 2; only the plugin and the library can change them.

The earlier Console-session variables `OPENRUM_SESSION` and `OPENRUM_CSRF_TOKEN` still work but are deprecated; replace them with an upload token.

## Local development stack

`dev`, `up`, `status`, `logs`, `restart`, `seed`, `stop`, `down` and `reset` are implemented by the Go tool in `cmd/openrum` of the OpenRUM repository. Inside a checkout, `openrum <command>` finds the repository root and runs `go run ./cmd/openrum <command>` there, so it needs Go, Docker with Compose v2 and, for `dev`, pnpm. Anywhere else it says that these commands only work inside a checkout and exits with status `1`. The commands themselves are described in [Local development](/docs/getting-started/local-development/#the-openrum-command).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command succeeded |
| `1` | An upload failed or its options were invalid, or a local stack command failed or was run outside a checkout. A forwarded command exits with the code of the Go tool |
| `2` | Usage error: no command, an unknown command or an unknown `sourcemaps` subcommand |
