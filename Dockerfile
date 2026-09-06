# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS console-build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/site/package.json apps/site/package.json
COPY packages/browser-sdk/package.json packages/browser-sdk/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/vite-plugin/package.json packages/vite-plugin/package.json
COPY examples/react-vite/package.json examples/react-vite/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @openrum/web build

FROM golang:1.26.6-alpine AS go-build
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum go.work go.work.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
ARG VERSION=dev
ARG COMMIT=unknown
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" -o /out/api ./services/api/cmd/api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ingest ./services/ingest/cmd/ingest && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/consumer ./services/consumer/cmd/consumer && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./services/worker/cmd/worker && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./services/api/cmd/migrate && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/demo ./services/api/cmd/demo

FROM alpine:3.24
LABEL org.opencontainers.image.title="OpenRUM" \
      org.opencontainers.image.description="Self-hosted real user monitoring services"
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates nginx tzdata && \
    mkdir -p /app/public /tmp/nginx && \
    chown -R 65532:65532 /app /tmp/nginx
COPY --from=go-build --chown=65532:65532 /out/* /app/
COPY --from=console-build --chown=65532:65532 /src/apps/web/dist/client/ /app/public/
COPY --chown=65532:65532 deploy/images/nginx.conf /app/nginx.conf
COPY --chown=65532:65532 --chmod=755 deploy/images/web /app/web
USER 65532:65532
WORKDIR /app
EXPOSE 8080 8081 8082 8083
ENTRYPOINT []
CMD ["/app/web"]
