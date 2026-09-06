# Kafka failure runbook

**Owner:** streaming/platform on-call · **Primary protection:** acknowledged events remain in replicated Kafka retention

## Trigger and impact

Page on `OpenRUMIngestUnavailable` or `OpenRUMKafkaLagHigh`. Confirm with ingest `unavailable` rate, producer acknowledgement P99, consumer lag, broker health and topic under-replicated partitions. Kafka write failure returns a non-success response, so the SDK may retry; OpenRUM must never claim durable acceptance before `acks=all`. Consumer failure delays query visibility but does not remove committed Kafka data.

## Safe response

1. Record incident start, alert labels, Helm revision, broker/controller health, ISR and topic disk usage. Assign an incident commander.
2. If only consumers are unhealthy, keep ingest open while retained capacity is sufficient; stop deployments and scale consumers within the tested limit. Do not reset offsets.
3. If producers cannot achieve durable acknowledgement or retention headroom is unsafe, use SDK remote configuration to lower sampling, then pause ingest only if required. Do not return a synthetic success.
4. Restore failed brokers/network/quota with the Kafka owner. Do not delete/recreate the event topic, force a preferred leader election during instability, or reduce replication/min-ISR to silence the alert.

## Recovery and validation

1. Confirm all partitions have a leader and ISR has converged. Produce and consume a canary envelope.
2. Track lag slope, ClickHouse insert success and data freshness until lag reaches baseline; increase consumers gradually and watch ClickHouse pressure.
3. Compare accepted envelope/event counters with committed and dead-letter counters over the incident window. Investigate any unexplained delta before closure.
4. Restore sampling in stages. Close only after ingest errors and acknowledgement P99 remain healthy for 30 minutes.

Escalate when estimated drain time exceeds retention remaining, any acknowledged event cannot be accounted for, or broker repair requires changing durability settings.

## Read-only evidence commands

```sh
kubectl -n <namespace> get deploy,pod -l app.kubernetes.io/instance=<release>
kubectl -n <namespace> logs deploy/<release>-consumer --since=15m
kafka-consumer-groups.sh --bootstrap-server <broker> --group <consumer-group> --describe
kafka-topics.sh --bootstrap-server <broker> --topic rum-events-v1 --describe
```

Save the output in the incident timeline. Never paste credentials or event payloads. Any offset reset requires a reviewed replay window, a backup of the current offsets and explicit approval from the incident commander.
