import { describe, expect, it } from "vitest";
import {
  bodyView,
  durationPosition,
  failureLabel,
  formatStamp,
  loadState,
  personOf,
  shortId,
  statusText,
  versioned,
} from "./sampleFormat";

describe("loadState", () => {
  it("reads the status class, and why there was no response", () => {
    expect(loadState({ status: 200 })).toEqual({ label: "成功", tone: "ok" });
    expect(loadState({ status: 304 })).toEqual({ label: "成功", tone: "ok" });
    expect(loadState({ status: 404 })).toEqual({ label: "客户端错误", tone: "warning" });
    expect(loadState({ status: 503, failure: "http" })).toEqual({
      label: "服务端错误",
      tone: "danger",
    });
    expect(loadState({ status: 0, failure: "network" })).toEqual({
      label: "网络错误",
      tone: "danger",
    });
    expect(loadState({ status: 0, failure: "timeout" })).toEqual({
      label: "请求超时",
      tone: "danger",
    });
    expect(loadState({ status: 0, failure: "abort" })).toEqual({
      label: "已取消",
      tone: "warning",
    });
    expect(loadState({ status: 0 })).toEqual({ label: "没有响应", tone: "danger" });
  });
});

describe("labels", () => {
  it("explains a failure type and passes an unknown one through", () => {
    expect(failureLabel("network")).toContain("没有收到响应");
    expect(failureLabel("something-new")).toBe("something-new");
    expect(failureLabel(undefined)).toBeUndefined();
  });

  it("shows a status code, or what stood in for it", () => {
    expect(statusText({ status: 200 })).toBe("200");
    expect(statusText({ status: 0, failure: "timeout" })).toBe("timeout");
    expect(statusText({ status: 0 })).toBe("无响应");
  });

  it("joins a name with its version only when there is one", () => {
    expect(versioned("iOS", "18.7")).toBe("iOS (18.7)");
    expect(versioned("iOS", undefined)).toBe("iOS");
    expect(versioned(undefined, "18.7")).toBeUndefined();
  });

  it("prefers the signed-in ID when naming who made a request", () => {
    expect(personOf({ userId: "1435448070", anonymousUserId: "uid_abc" })).toBe("1435448070");
    expect(personOf({ anonymousUserId: "uid_abc" })).toBe("uid_abc");
    expect(personOf({})).toBe("");
  });

  it("shortens only what is long", () => {
    expect(shortId("short")).toBe("short");
    expect(shortId("uid_qdp44uuk40clowwi")).toBe("uid_qdp44uuk…");
  });

  it("formats a time with seconds and dashes", () => {
    expect(formatStamp("2026-10-12T11:07:34.000Z")).toMatch(/^2026-10-12 \d{2}:07:34$/);
  });
});

describe("durationPosition", () => {
  const percentiles = { p50: 100, p75: 200, p95: 400 };

  it("places a request and the percentiles on one scale a little wider than P95", () => {
    const position = durationPosition(250, percentiles)!;
    expect(position.p95).toBeCloseTo(80, 5);
    expect(position.request).toBeCloseTo(50, 5);
    expect(position.slowerThanP95).toBe(false);
  });

  it("stretches the scale to a request slower than everything else", () => {
    const position = durationPosition(1000, percentiles)!;
    expect(position.request).toBe(100);
    expect(position.slowerThanP95).toBe(true);
    expect(position.p95).toBeCloseTo(40, 5);
  });

  it("says nothing when the endpoint has no percentiles to compare with", () => {
    expect(durationPosition(100, { p50: null, p75: null, p95: null })).toBeUndefined();
  });
});

describe("bodyView", () => {
  it("indents compact JSON and leaves a body that would change untouched", () => {
    expect(bodyView('{"a":1,"b":[2]}').text).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    const spaced = '{ "a": 1 }';
    expect(bodyView(spaced).text).toBe(spaced);
    const precise = '{"id":12345678901234567890}';
    expect(bodyView(precise).text).toBe(precise);
    expect(bodyView("plain text").text).toBe("plain text");
  });

  it("says when a body was redacted, cut or never taken", () => {
    expect(bodyView('{"token":"[REDACTED]"}').notes).toEqual(["敏感内容已被遮盖。"]);
    const cut = bodyView('{"a":"xxxx…[truncated]');
    expect(cut.notes).toEqual(["内容已截断，只保留开头部分。"]);
    expect(cut.text).toBe('{"a":"xxxx…[truncated]');
    expect(bodyView("[omitted: body larger than 64 KB]")).toEqual({
      text: "",
      notes: ["内容超过 64 KB，没有采集。"],
    });
    expect(bodyView('{"a":1}').notes).toEqual([]);
  });
});
