import assert from "node:assert/strict";
import test from "node:test";
import { createOpenRUMDSN, createOpenRUMDSNForInstance, parseOpenRUMDSN } from "../src/dsn.ts";

test("creates and parses one public OpenRUM DSN", () => {
  const dsn = createOpenRUMDSNForInstance("https://rum.example.com/console", "orr_pk_test");
  assert.equal(dsn, "https://orr_pk_test@rum.example.com/ingest/v1/envelope");
  assert.deepEqual(parseOpenRUMDSN(dsn), {
    endpoint: "https://rum.example.com/ingest/v1/envelope",
    writeKey: "orr_pk_test",
  });
});

test("round trips encoded keys without sending credentials in the endpoint", () => {
  const dsn = createOpenRUMDSN("http://127.0.0.1:4173/ingest/v1/envelope", "key:value");
  assert.equal(dsn, "http://key%3Avalue@127.0.0.1:4173/ingest/v1/envelope");
  assert.deepEqual(parseOpenRUMDSN(dsn), {
    endpoint: "http://127.0.0.1:4173/ingest/v1/envelope",
    writeKey: "key:value",
  });
});

test("rejects incomplete or unsafe DSNs", () => {
  assert.throws(() => parseOpenRUMDSN("https://rum.example.com/ingest/v1/envelope"));
  assert.throws(() => parseOpenRUMDSN("https://key:secret@rum.example.com/ingest/v1/envelope"));
  assert.throws(() => parseOpenRUMDSN("javascript:key@rum.example.com"));
  assert.throws(() => createOpenRUMDSN("https://rum.example.com/path?token=no", "key"));
});
