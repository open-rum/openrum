#!/usr/bin/env bash
set -euo pipefail

# Offline, consistent backup of the bundled single-host data volumes. The
# operator must keep .env.production separately in encrypted off-host storage.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_dir="${1:-}"
if [[ -z "$backup_dir" || "$backup_dir" != /* || -e "$backup_dir" ]]; then
  echo "Usage: $0 /absolute/path/to/a/new-backup-directory" >&2
  exit 2
fi

compose=(docker compose --env-file "$script_dir/.env.production" -f "$script_dir/production.compose.yml")
volumes=(postgres-data clickhouse-data clickhouse-logs kafka-data redis-data caddy-data caddy-config)
"${compose[@]}" config --quiet
for name in "${volumes[@]}"; do
  docker volume inspect "openrum-production_${name}" >/dev/null
done
docker pull alpine:3.24 >/dev/null
mkdir -m 700 "$backup_dir"

resume_on_exit() {
  local status=$?
  trap - EXIT
  "${compose[@]}" up -d --wait || status=1
  exit "$status"
}
trap resume_on_exit EXIT

"${compose[@]}" down
for name in "${volumes[@]}"; do
  docker run --rm \
    --mount "type=volume,src=openrum-production_${name},dst=/data,readonly" \
    --mount "type=bind,src=${backup_dir},dst=/backup" \
    alpine:3.24 sh -ec 'cd /data && tar -czf "/backup/$1.tgz" .' sh "$name"
done

# Resume ingestion before calculating checksums; hashing large ClickHouse
# archives does not need to extend the service outage.
trap - EXIT
"${compose[@]}" up -d --wait
(
  cd "$backup_dir"
  sha256sum ./*.tgz > SHA256SUMS
)
chmod 600 "$backup_dir"/*
echo "Backup created at $backup_dir. Encrypt and copy it off-host, together with .env.production."
