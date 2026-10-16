import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isSensitiveBodyKey,
  isTextualContentType,
  maxBodyChars,
  maxBodyReadChars,
  omittedBody,
  prepareBody,
  redactBody,
  truncatedMarker,
} from "../src/body.ts";

// The same names the Go tests use (internal/privacy/body_test.go): the browser and the
// Consumer redact by one list.
void test("sensitive body keys match the server's list", () => {
  for (const key of [
    "password",
    "Password",
    "newPassword",
    "access_token",
    "refreshToken",
    "Authorization",
    "api-key",
    "apiKey",
    "cardNumber",
    "card_number",
    "creditCard",
    "cvv",
    "ssn",
    "email",
    "userEmail",
    "phone",
    "sessionId",
    "csrfToken",
    "clientSecret",
    "signature",
  ]) {
    assert.equal(isSensitiveBodyKey(key), true, key);
  }
  for (const key of [
    "author",
    "authority",
    "orderId",
    "items",
    "sku",
    "qty",
    "total",
    "status",
    "name",
    "coupon",
    "address",
  ]) {
    assert.equal(isSensitiveBodyKey(key), false, key);
  }
});

void test("redacts sensitive keys at any depth and keeps the rest", () => {
  const input = JSON.stringify({
    items: [{ sku: "A-1", qty: 2 }],
    coupon: "SPRING",
    contact: { email: "buyer@example.com", phone: "13800000000" },
    payment: { cardNumber: "4242 4242 4242 4242", token: { value: "tok_abc", nested: ["x"] } },
    total: 199.5,
    ok: true,
    none: null,
  });
  const got = redactBody(input);
  for (const leaked of ["buyer@example.com", "13800000000", "4242", "tok_abc", "nested"]) {
    assert.ok(!got.includes(leaked), `${leaked} survived: ${got}`);
  }
  for (const kept of [
    '"sku":"A-1"',
    '"qty":2',
    '"coupon":"SPRING"',
    '"total":199.5',
    '"ok":true',
  ]) {
    assert.ok(got.includes(kept), `${kept} lost: ${got}`);
  }
  assert.ok(got.includes('"email":"[REDACTED]"') && got.includes('"token":"[REDACTED]"'));
});

void test("a body with nothing to redact keeps its original text", () => {
  const input = '{\n  "orderId": "o-1",\n  "status": "created"\n}';
  assert.equal(redactBody(input), input);
});

void test("redacts patterns inside strings", () => {
  const got = redactBody('{"note":"contact ops@example.com or use Bearer abc.def.ghi"}');
  assert.ok(!got.includes("ops@example.com") && !got.includes("abc.def.ghi"), got);
});

void test("redacts form-encoded bodies", () => {
  const got = redactBody("user=alice&password=hunter2&note=mail%20me%40example.com&page=3");
  assert.ok(!got.includes("hunter2") && !got.includes("example.com"), got);
  assert.ok(got.includes("user=alice") && got.includes("page=3"), got);
  assert.ok(got.includes("password=%5BREDACTED%5D"), got);
});

void test("text that is not complete JSON still loses scalar values under sensitive keys", () => {
  for (const input of [
    '{"user":"a","password":"hunter2","items":[1,2',
    'prefix {"api_key": "sk-live-123", "n": 4} suffix',
    '{"a":1,"token":99999 trailing garbage',
  ]) {
    const got = redactBody(input);
    assert.ok(
      !got.includes("hunter2") && !got.includes("sk-live-123") && !got.includes("99999"),
      `${input} -> ${got}`,
    );
  }
});

void test("a deeply nested body is handled by the fallback", () => {
  const deep = "[".repeat(200) + "]".repeat(200);
  assert.ok(redactBody(deep).length > 0);
});

void test("prepareBody cuts a long body and says so, once", () => {
  const long = `{"data":"${"é".repeat(5000)}"}`;
  const got = prepareBody(long);
  assert.ok(got?.endsWith(truncatedMarker));
  assert.equal(got?.length, maxBodyChars + truncatedMarker.length);
  assert.ok(got?.startsWith('{"data":"'));
});

void test("prepareBody never ends on half a surrogate pair", () => {
  const got = prepareBody("a".repeat(maxBodyChars - 1) + "😀😀");
  assert.ok(got?.endsWith(truncatedMarker));
  const body = got?.slice(0, -truncatedMarker.length) ?? "";
  const last = body.charCodeAt(body.length - 1);
  assert.ok(!(last >= 0xd800 && last <= 0xdbff), "ends with a lone high surrogate");
});

void test("prepareBody omits what it cannot redact completely, and ignores empty bodies", () => {
  assert.equal(prepareBody("x".repeat(maxBodyReadChars + 1)), omittedBody);
  assert.equal(prepareBody(""), undefined);
  assert.equal(prepareBody("  \n"), undefined);
  assert.equal(prepareBody("plain"), "plain");
});

void test("only textual content types are read", () => {
  for (const type of [
    "application/json",
    "application/json; charset=utf-8",
    "application/problem+json",
    "text/plain",
    "text/html",
    "application/xml",
    "application/x-www-form-urlencoded",
    null,
    undefined,
    "",
  ]) {
    assert.equal(isTextualContentType(type), true, String(type));
  }
  for (const type of [
    "text/event-stream",
    "image/png",
    "application/octet-stream",
    "application/pdf",
    "multipart/form-data; boundary=x",
    "video/mp4",
  ]) {
    assert.equal(isTextualContentType(type), false, type);
  }
});
