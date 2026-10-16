import { describe, expect, it } from "vitest";
import { apiFailureLevel } from "./apis";

describe("apiFailureLevel", () => {
  it("keeps red for rates that need action, not for any failure at all", () => {
    expect(apiFailureLevel(0)).toBe("normal");
    expect(apiFailureLevel(0.19)).toBe("normal");
    expect(apiFailureLevel(0.99)).toBe("normal");
    expect(apiFailureLevel(1)).toBe("warning");
    expect(apiFailureLevel(5)).toBe("warning");
    expect(apiFailureLevel(5.01)).toBe("danger");
  });
});
