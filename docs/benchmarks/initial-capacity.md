# Initial capacity benchmark

## Required production-like run

This benchmark is a release gate, not a laptop estimate. Measure the pilot project's observed peak PV/s and events/PV first, then calculate:

`required_eps = peak_pv_per_second × events_per_pv × sample_rate × 3`

Run against an isolated Kubernetes environment with production resource limits, Kafka partition/replication settings and ClickHouse topology. Use a dedicated project and delete its tagged load data after evidence is retained.

```bash
EVENT_RATE=<required_eps> DURATION=15m RUN_ID=<unique-run> \
OPENRUM_INGEST_URL=<ingest-url> OPENRUM_WRITE_KEY=<load-project-key> \
k6 run tests/load/ingest-production.js
```

At the same time, isolate Console query load from ingestion:

```bash
QUERY_RATE=<expected-peak-qps-times-3> DURATION=15m \
OPENRUM_API_URL=<api-url> OPENRUM_PROJECT_ID=<project-id> OPENRUM_SESSION=<session> \
k6 run tests/load/query-production.js
```

Then stop load and measure lag recovery for up to 15 minutes. Reconcile the k6 accepted-event total with both `count()` and `uniqExact(event_id)` in ClickHouse using the run ID.

## Pass criteria

| Signal | Required result |
| --- | --- |
| Ingest HTTP | failures <1%; P95 <250 ms; accepted responses are Kafka-acknowledged |
| Event integrity | accepted = stored = unique; no unexplained rejection/drop |
| Query API | failures <1%; P95 <2 s; P99 <5 s during ingest load |
| Pipeline | no unbounded lag; freshness returns <60 s within 15 minutes |
| Saturation | CPU, memory, Kafka disk/ISR and ClickHouse merges retain documented headroom |

## Result record

### 2026-09-03 local overload rehearsal

Status: **release gate blocked; production-like run is still required**.

This run deliberately exercised the single-replica local Compose topology. It is useful for finding overload behavior, but it is not a capacity claim and must not be used to size a production cluster.

Because measured production peak PV/s and events/PV were not yet available, the run used an explicit planning assumption for the known ten-million-PV/day workload:

- average traffic: about 116 PV/s;
- assumed peak factor: 5×, or about 579 PV/s;
- assumed collection density: 10 events/PV at a 100% sample rate;
- 3× target: 17,400 events/s, sent in 100-event envelopes;
- concurrent Console query target: 30 requests/s;
- duration: 60 seconds; run ID: `local-3x-20260903`.

Topology: Docker Compose on one development machine, one replica of each OpenRUM service, one Kafka broker with 12 partitions, one ClickHouse node, and no per-service CPU or memory limits. Both load generators ran concurrently in containers through the Web reverse proxy.

| Signal | Observed result | Gate |
| --- | --- | --- |
| Ingest HTTP | P95 26.59 s; 39.14% failed/timed out; 2,560 requests completed; 7,882 iterations dropped | Fail |
| Client-acknowledged events | 1,558 successful envelopes × 100 = 155,800 events | Evidence only |
| Tagged ClickHouse events | 158,300 rows; 158,300 unique event IDs; received over 72 s | Fail reconciliation |
| Ambiguous timeout outcome | 25 envelopes / 2,500 events were stored although the client did not observe success | Blocker |
| Effective acknowledged throughput | about 2,029 events/s over the observed run, while overloaded | Not a capacity claim |
| Query API | P95 21.21 s; P99 30.16 s; 40.56% failed; 759/1,277 succeeded; 524 iterations dropped | Fail |
| Pipeline recovery | Kafka consumer lag observed at 0 on all 12 partitions within 7 minutes of load ending | Pass recovery bound; exact peak lag not captured |
| Recovered health | `/health/ready` 200 in 1.6 ms; Console root 200 in 1.8 ms | Pass |
| Approximate payload | 88.9 bytes/event for serialized custom attributes, excluding fixed columns and storage compression | Evidence only |

The Kafka group ended at 1,594 envelopes. Eleven were the demo seed baseline and 1,583 belonged to the load run, matching the 158,300 tagged rows. The difference from the 1,558 client-observed successes is therefore not ClickHouse duplication: requests completed server-side after k6 had classified them as timeouts. Retry semantics must remain event-ID idempotent, and capacity verification must report ambiguous outcomes separately from acknowledged successes.

The immediate post-load saturation snapshot showed ClickHouse at 158% CPU / 2.12 GiB, Kafka at 113% CPU / 768 MiB, and Consumer at 28% CPU / 49 MiB. After drain, ClickHouse was about 3% CPU / 1.87 GiB and Kafka about 6% CPU / 853 MiB. These host-wide percentages and unlimited containers are diagnostic only; production evidence needs Prometheus history and explicit resource limits.

Before a controlled real-project pilot, collect measured peak PV/s and events/PV, then repeat for 15 minutes in the Kubernetes topology with intended replica counts, resource requests/limits, Kafka replication and ClickHouse storage. Capture maximum lag continuously, exact recovery time, ISR/disk/merge headroom, and reconcile client-acknowledged, ambiguous and stored event totals. The current single-replica topology does **not** meet the NFR at the assumed 3× load.
