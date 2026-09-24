# Storage pressure runbook

**Owner:** platform/data on-call · **Primary protection:** preserve Kafka durability and restore writable headroom before replaying backlog

## Trigger and impact

Page on `OpenRUMPersistentVolumeSpaceLow`, `OpenRUMPersistentVolumeSpaceCritical`,
`OpenRUMPersistentVolumeInodesLow`, `OpenRUMPersistentVolumeFillingSoon`,
`OpenRUMKafkaRetentionHeadroomLow`, `OpenRUMStoragePressureGuardActive` or
`OpenRUMStorageIngestHardStopActive`.

ClickHouse pressure makes Console data stale while Consumer keeps the Kafka offset
uncommitted. Kafka pressure is more urgent: once the broker cannot acknowledge a
write, Ingest returns `503` and Browser SDK retries are finite. PostgreSQL pressure
is a control-plane outage. Redis and object storage normally degrade optional or
cached capabilities rather than becoming the Event source of truth.

## Safe response

1. Identify the full filesystem and record byte plus inode headroom. In Compose,
   PostgreSQL, ClickHouse, Kafka, Redis and container logs may share one Docker
   disk image even though they use different named volumes.
2. If Kafka retention headroom is falling, reduce Browser SDK traffic before it
   reaches zero. When the ClickHouse capacity guard is enabled it applies the
   configured temporary sampling cap automatically; otherwise change Project
   sampling or stop nonessential producers deliberately.
3. An Instance Owner can use **Instance Settings → Data lifecycle → Emergency
   storage recovery**. Generate the recommended plan, review the Project/month
   groups and projected usage, then confirm with the required phrase and current
   password. The Worker drops only complete old partitions and never touches the
   protected recent-data window. If the Console says the available old data is
   insufficient, expand the volume as well.
4. If the Console or PostgreSQL control plane is unavailable, expand the volume
   before attempting any database maintenance. Do not delete Kafka topics,
   database files, ClickHouse parts, WAL, or Docker volumes to make space.
5. Pause expensive Console queries and retention/mutation jobs if they amplify
   storage pressure. Never reset Consumer offsets to make lag disappear.

## Capacity guard

The API and Ingest guards read `system.disks`. At 10% free, `/api/v1/sdk/config`
caps Event, API Request and error sampling for all Browser SDKs. At 5% free, the
Ingest circuit breaker returns an empty successful acceptance and deliberately
drops new envelopes without reading them, avoiding retry amplification. The hard
stop remains latched until a successful probe reports more than 10% free.

```yaml
config:
  storagePressure:
    guardEnabled: true
    warningFreeRatio: "0.15"
    criticalFreeRatio: "0.10"
    hardStopFreeRatio: "0.05"
    recoveryFreeRatio: "0.10"
    emergencySampleRate: "0.10"
    pollInterval: 30s
```

This guard protects ClickHouse only. PostgreSQL and Kafka commonly run outside the
OpenRUM namespace, so their provider or cluster storage alerts remain mandatory.
Set `config.kafkaRetentionDuration` to the real Event topic retention; OpenRUM uses
it to expose remaining retention headroom while a message is blocked.

## Recovery and validation

1. Confirm free bytes and free inode count are above the recovery target and perform the
   dependency's supported read/write canary.
2. Confirm Kafka partitions have leaders, Ingest durable acknowledgements succeed,
   Consumer lag is decreasing, and ClickHouse inserts succeed.
3. Watch the Console data-delay indicator clear. Confirm the capacity guard releases
   automatically, the global storage Banner disappears, Ingest no longer increments
   `openrum_ingest_storage_pressure_dropped_envelopes_total`, and Browser SDK
   configuration returns the normal Project rates.
4. Close only after lag and freshness return to baseline and capacity growth is
   understood. Increase the volume before restoring full sampling if recurrence is
   likely.

## Emergency cleanup safety model

The emergency flow is intentionally different from ordinary retention cleanup.
It reads `system.parts`, groups allowlisted product tables by Project and month,
and selects the oldest groups until projected disk usage is at most 85%. A group
is eligible only when its calendar month ended before the protected 24-hour
window and every part is older than that boundary. The preview lasts ten minutes and is bound to its operator; execution is
serialized globally, retried with a limit, and audited.

Partition deletion releases space without scheduling the large rewrite required
by `ALTER ... DELETE`. It is still irreversible. A finished job does not force
the circuit breaker open: the capacity monitor must observe usage below 90%.

The application health endpoints are intentionally shallow and do not replace
these alerts: a service can accept TCP connections while its next write fails.
