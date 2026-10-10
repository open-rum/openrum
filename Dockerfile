# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:24-alpine AS console-build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/site/package.json apps/site/package.json
COPY packages/browser-sdk/package.json packages/browser-sdk/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/sourcemap/package.json packages/sourcemap/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY examples/react-vite/package.json examples/react-vite/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --no-runtime
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @openrum/browser build && pnpm --filter @openrum/web build

FROM --platform=$BUILDPLATFORM golang:1.26.9-alpine AS go-build
WORKDIR /src
ARG TARGETOS
ARG TARGETARCH
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum go.work go.work.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
ARG VERSION=dev
ARG COMMIT=unknown
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    export CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" && \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/api ./services/api/cmd/api && \
    go build -trimpath -ldflags="-s -w" -o /out/ingest ./services/ingest/cmd/ingest && \
    go build -trimpath -ldflags="-s -w" -o /out/consumer ./services/consumer/cmd/consumer && \
    go build -trimpath -ldflags="-s -w" -o /out/worker ./services/worker/cmd/worker && \
    go build -trimpath -ldflags="-s -w" -o /out/migrate ./services/api/cmd/migrate && \
    go build -trimpath -ldflags="-s -w" -o /out/demo ./services/api/cmd/demo

FROM alpine:3.24
LABEL org.opencontainers.image.title="OpenRUM" \
      org.opencontainers.image.description="Self-hosted real user monitoring services"
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates nginx tzdata && \
    mkdir -p /app/public /app/sdk /tmp/nginx && \
    chown -R 65532:65532 /app /tmp/nginx
COPY --from=go-build --chown=65532:65532 /out/* /app/
COPY --from=console-build --chown=65532:65532 /src/apps/web/dist/client/ /app/public/
COPY --from=console-build --chown=65532:65532 /src/packages/browser-sdk/dist/index.iife.js /app/sdk/index.iife.js
COPY --chown=65532:65532 deploy/images/nginx.conf /app/nginx.conf
COPY --chown=65532:65532 --chmod=755 deploy/images/web /app/web
USER 65532:65532
WORKDIR /app
EXPOSE 8080 8081 8082 8083
ENTRYPOINT []
CMD ["/app/web"]
