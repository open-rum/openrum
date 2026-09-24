---
title: Storage pressure
description: Detect, contain and recover from full disks with explicit sampling and Ingest protection.
appliesTo: Alpha
---

A full disk does not have one universal failure mode. ClickHouse pressure delays
query visibility, Kafka pressure stops durable Ingest acknowledgements, and
PostgreSQL pressure interrupts the control plane. OpenRUM never turns a failed
Kafka acknowledgement into a successful response.

## Alerts to install

Enable both `serviceMonitor` and `prometheusRules` in the Helm values. The bundled
rules cover:

- persistent-volume free bytes, inode exhaustion, predicted fill time and node DiskPressure;
- ClickHouse capacity-probe failure and automatic guard activation;
- ClickHouse insert errors and data freshness;
- Kafka Consumer lag and configured retention headroom.

The PVC rules cover claims in the OpenRUM release namespace. Managed PostgreSQL,
Kafka or ClickHouse in another namespace or provider still require the provider's
disk alarms.

## Automatic ClickHouse protection

The storage-pressure guard reads ClickHouse `system.disks` every 30 seconds. At
90% used it caps the Browser SDK's Event, error and API sampling rates at 10%.
At 95% used, Ingest opens a hard-stop circuit breaker and returns an empty `202`
acceptance without reading or publishing the envelope. This deliberate drop
prevents a retry storm while ClickHouse is critically full. Both protections
release only after usage falls below 90%.

```yaml
config:
  kafkaRetentionDuration: 168h # set this to the real topic retention
  storagePressure:
    guardEnabled: true
    warningFreeRatio: "0.15"
    criticalFreeRatio: "0.10"
    hardStopFreeRatio: "0.05"
    recoveryFreeRatio: "0.10"
    emergencySampleRate: "0.10"
    pollInterval: 30s
serviceMonitor:
  enabled: true
prometheusRules:
  enabled: true
```

The ClickHouse account must be able to read `system.disks`. If it cannot before a
hard stop has been observed, the guard fails open, emits
`openrum_storage_capacity_probe_success 0`, and reports capacity as unknown. A
known hard stop stays latched until a successful reading confirms recovery. This
protection does not resize storage and does not protect a Kafka disk hosted elsewhere.

## What operators see

Every Console route shows a top banner for low capacity, automatic sampling and
the Ingest hard stop. Instance Settings also shows used/free capacity and the
active protection. Project routes retain the data-delay badge.

Once a threshold is active, an Instance Owner can select **Clean up old data**
from the hard-stop banner, or open **Settings → Instance → Data lifecycle →
Emergency storage recovery**:

1. Generate the recommended cleanup plan. OpenRUM selects complete old
   Project/month groups; no command line is required.
2. Review current usage, estimated space release and projected usage. Only a
   calendar month that ended more than 24 hours ago is eligible; a quiet current
   month is never selected.
3. Enter the confirmation phrase and current password. The Console then tracks
   the background job.
4. The capacity guard checks the result and reopens Ingest only after usage is
   below 90%.

Emergency cleanup differs from ordinary retention. It drops complete ClickHouse
partitions to avoid a large rewrite on an already-full disk. If the safe old
months cannot reach the 85% target, the Console explicitly says that storage
must still be expanded. Deletion is irreversible.

Follow the [ClickHouse](/docs/self-hosting/clickhouse/) and
[Kafka](/docs/self-hosting/kafka/) runbooks for recovery. Never delete database
files, Kafka topics or Docker volumes merely to make free space.
