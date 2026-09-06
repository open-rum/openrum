# Ingest pipeline load test

This k6 scenario targets 10,000 accepted Events/s by default, using 100 Events per envelope. A successful HTTP response only means Kafka acknowledged the envelope; verification against ClickHouse is mandatory.

1. Start PostgreSQL, ClickHouse, Kafka, Redis, Ingest, and Consumer. Apply both database migrations first.
2. Create a production Project whose allowed origins include `https://load.example.com`, and copy its one-time write key.
3. Run a unique test:

   ```bash
   RUN_ID="load-$(date +%s)" OPENRUM_WRITE_KEY='orr_pk_...' k6 run tests/load/ingest.js
   ```

4. Record the `openrum_accepted_events` total from k6, wait until `openrum_consumer_data_freshness_seconds` returns below 60, then query ClickHouse:

   ```sql
   SELECT count(), uniqExact(event_id)
   FROM rum_events FINAL
   WHERE event_type = 'custom'
     AND attributes['tag.load_run_id'] = 'load-<timestamp>';
   ```

`count()` and `uniqExact(event_id)` must equal the k6 accepted total. Any mismatch is silent loss or duplication and fails the run. For the required burst test, set `EVENT_RATE=30000 DURATION=5m`; the Kafka lag must recover below 60 seconds within 15 minutes. Keep `BATCH_SIZE=100` at these rates so the request-rate guard does not become the tested bottleneck. Run capacity tests against an isolated environment, never a shared production Project.

For production-like evidence, point `OPENRUM_INGEST_URL` and `OPENRUM_API_URL` at their intended ingress paths. Sending both scenarios through the local Compose Web proxy also measures that single proxy and is only an overload rehearsal. A request that times out at k6 can still be Kafka-acknowledged after the client gives up; record these ambiguous outcomes separately, reconcile the tagged stored total, and rely on unique event IDs for safe retry deduplication.
