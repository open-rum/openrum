import { describe, expect, it } from "vitest";
import { apiFailureLevel, apiFailureRate, formatAPIFailureRate } from "./apis";

describe("apiFailureLevel", () => {
  it("distinguishes absent requests from observed requests without failures", () => {
    expect(apiFailureRate({ requests: 0, failures: 0 })).toBeNull();
    expect(apiFailureLevel(null)).toBe("unknown");
    expect(formatAPIFailureRate({ requests: 0, failures: 0 })).toBe("—");
    expect(formatAPIFailureRate({ requests: 20, failures: 0 })).toBe("0.00%");
    expect(formatAPIFailureRate({ requests: 20, failures: 1 })).toBe("5.00%");
  });
  it("keeps red for rates that need action, not for any failure at all", () => {
    expect(apiFailureLevel(0)).toBe("normal");
    expect(apiFailureLevel(0.19)).toBe("normal");
    expect(apiFailureLevel(0.99)).toBe("normal");
    expect(apiFailureLevel(1)).toBe("warning");
    expect(apiFailureLevel(5)).toBe("warning");
    expect(apiFailureLevel(5.01)).toBe("danger");
  });
});
