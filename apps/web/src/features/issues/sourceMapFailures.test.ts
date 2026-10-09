import { describe, expect, it } from "vitest";
import { sourceMapFailureLabel, sourceMapFailureLabels } from "./sourceMapFailures";

describe("source map failure labels", () => {
  it("covers every failure code the mapper emits", () => {
    expect(Object.keys(sourceMapFailureLabels).sort()).toEqual(
      [
        "ambiguous_artifact",
        "invalid_map",
        "missing_artifact",
        "missing_release",
        "no_mapping",
        "resource_limit",
        "unsupported_index_url",
      ].sort(),
    );
  });

  it("labels known codes and keeps unknown codes visible", () => {
    expect(sourceMapFailureLabel("missing_artifact")).toBe("没有找到与脚本地址匹配的 Source Map");
    expect(sourceMapFailureLabel("future_code")).toBe("无法还原（future_code）");
    expect(sourceMapFailureLabel(undefined)).toBeUndefined();
    expect(sourceMapFailureLabel("")).toBeUndefined();
  });
});
