#!/usr/bin/env bash
set -euo pipefail

# Restores only to a fresh project on a replacement host. Refuses to touch
# existing volumes or containers; never overwrites a running Instance.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_dir="${1:-}"
if [[ -z "$backup_dir" || "$backup_dir" != /* || ! -d "$backup_dir" ]]; then
  echo "Usage: $0 /absolute/path/to/an-existing-backup-directory" >&2
  exit 2
fi

compose=(docker compose --env-file "$script_dir/.env.production" -f "$script_dir/production.compose.yml")
volumes=(postgres-data clickhouse-data clickhouse-logs kafka-data redis-data caddy-data caddy-config)
"${compose[@]}" config --quiet
(
  cd "$backup_dir"
  sha256sum -c SHA256SUMS
)
if [[ -n "$("${compose[@]}" ps -aq)" ]]; then
  echo "Refusing to restore: openrum-production containers already exist." >&2
  exit 1
fi
for name in "${volumes[@]}"; do
  if docker volume inspect "openrum-production_${name}" >/dev/null 2>&1; then
    echo "Refusing to restore: openrum-production_${name} already exists." >&2
    exit 1
  fi
done
docker pull alpine:3.24 >/dev/null

for name in "${volumes[@]}"; do
  docker volume create "openrum-production_${name}" >/dev/null
  docker run --rm \
    --mount "type=volume,src=openrum-production_${name},dst=/data" \
    --mount "type=bind,src=${backup_dir},dst=/backup,readonly" \
    alpine:3.24 sh -ec 'cd /data && tar -xzf "/backup/$1.tgz"' sh "$name"
done
echo "Volumes restored. Verify .env.production and the exact application image before starting the stack."
