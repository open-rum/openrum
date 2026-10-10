# `@openrum/cli`

The `openrum` command.

The package is not published to npm yet. Build it from an OpenRUM checkout with `pnpm --filter @openrum/cli build` and install that directory into your application.

## Upload Source Maps

```sh
OPENRUM_BASE_URL=https://rum.example.com \
OPENRUM_PROJECT_ID=00000000-0000-4000-8000-000000000000 \
OPENRUM_RELEASE=storefront@1.8.0 \
OPENRUM_UPLOAD_TOKEN=orut_... \
pnpm exec openrum sourcemaps upload --out-dir dist --url-prefix static/app/
```

It uses the same implementation as the Vite plugin in [`@openrum/source-map`](../source-map); see that README for what a build does, how Artifact names are formed and how `--replace` behaves. Use the command line for builds that do not run through Vite, such as Next.js.

| Flag           | Environment variable   |
| -------------- | ---------------------- |
| `--base-url`   | `OPENRUM_BASE_URL`     |
| `--project-id` | `OPENRUM_PROJECT_ID`   |
| `--release`    | `OPENRUM_RELEASE`      |
| `--dist`       | `OPENRUM_DIST`         |
| `--commit-sha` | `OPENRUM_COMMIT_SHA`   |
| `--out-dir`    | `OPENRUM_OUT_DIR`      |
| `--url-prefix` | `OPENRUM_URL_PREFIX`   |
| `--replace`    | `OPENRUM_REPLACE=true` |
| `--token`      | `OPENRUM_UPLOAD_TOKEN` |

Prefer the environment variable for the token so it does not appear in process listings or shell history. The command exits with status `1` when any file fails. Flags take precedence over environment variables.

The earlier `openrum-sourcemaps` command is still installed. It is `openrum sourcemaps upload` without the subcommand, so existing build scripts keep working.

## Local development stack

`openrum dev`, `up`, `status`, `logs`, `restart`, `seed`, `stop`, `down` and `reset` manage the local development stack. They are implemented by the Go tool in `cmd/openrum` of the OpenRUM repository, so they only work inside a checkout of it, with Go, Docker and pnpm installed. From inside the checkout, `openrum <command>` finds the repository root and runs `go run ./cmd/openrum <command>` there; anywhere else it says so and exits with status `1`. Contributors can keep using `pnpm openrum <command>` from the repository root, which runs the same Go tool directly.

## Development

```sh
pnpm --filter @openrum/cli test
pnpm --filter @openrum/cli build
node packages/cli/dist/openrum.js --help
```
