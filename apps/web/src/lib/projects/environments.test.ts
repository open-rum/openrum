import { describe, expect, it } from "vitest";
import { environmentLabel, isProjectEnvironment, parseEnvironments } from "./environments";

describe("project environments", () => {
  it("keeps only the fixed environments, in canonical order", () => {
    expect(parseEnvironments("production\ncanary\n\ntest\nproduction")).toEqual([
      "test",
      "production",
    ]);
  });

  it("labels the fixed set and recognises it", () => {
    expect(environmentLabel("staging")).toBe("灰度");
    expect(isProjectEnvironment("development")).toBe(true);
    expect(isProjectEnvironment("canary")).toBe(false);
  });
});
