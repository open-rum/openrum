import { describe, expect, it } from "vitest";
import {
  blankRule,
  conditionText,
  copyName,
  deliveryErrorText,
  formatMetricValue,
  ruleSummary,
  ruleTemplates,
  validateRule,
} from "./alertRules";

describe("alert rule helpers", () => {
  it("describes a rule in one line with its unit", () => {
    expect(
      conditionText({ metric: "error_rate", comparator: "gte", threshold: 2, windowMinutes: 5 }),
    ).toBe("错误率 ≥ 2% · 最近 5 分钟");
    expect(formatMetricValue("lcp_p75", 2500)).toBe("2,500 ms");
    expect(formatMetricValue("error_count", 12)).toBe("12");
    expect(formatMetricValue("api_failure_rate", 3.456)).toBe("3.46%");
  });

  it("summarizes scope, condition, channels and cooldown", () => {
    const rule = { ...blankRule("production"), channelIds: ["a"] };
    expect(ruleSummary(rule, ["飞书·前端值班群"])).toBe(
      "当production 环境最近 5 分钟错误率 ≥ 2%时，通知 飞书·前端值班群。同一规则 30 分钟内最多通知一次。",
    );
    expect(ruleSummary({ ...rule, environment: "", cooldownMinutes: 60 }, [])).toContain(
      "所有环境",
    );
    expect(ruleSummary({ ...rule, channelIds: [] }, [])).toContain("只在控制台记录");
  });

  it("validates like the backend", () => {
    expect(validateRule(blankRule("production"))).toEqual({ name: "请填写规则名称。" });
    const valid = { ...blankRule("production"), name: "错误率" };
    expect(validateRule(valid)).toEqual({});
    expect(validateRule({ ...valid, threshold: -1 }).threshold).toBeTruthy();
    expect(validateRule({ ...valid, threshold: Number.NaN }).threshold).toBeTruthy();
    // Errors per page view can exceed 100%, API failures cannot.
    expect(validateRule({ ...valid, threshold: 150 })).toEqual({});
    expect(
      validateRule({ ...valid, metric: "api_failure_rate", threshold: 150 }).threshold,
    ).toBeTruthy();
    expect(validateRule({ ...valid, windowMinutes: 7 }).windowMinutes).toBeTruthy();
    expect(validateRule({ ...valid, cooldownMinutes: 2 }).cooldownMinutes).toBeTruthy();
    expect(validateRule({ ...valid, environment: "Prod!" }).environment).toBeTruthy();
    expect(validateRule({ ...valid, name: "错".repeat(41) }).name).toBe("名称过长。");
    expect(
      validateRule({
        ...valid,
        channelIds: Array.from({ length: 11 }, (_, index) => String(index)),
      }).channelIds,
    ).toBeTruthy();
  });

  it("offers templates that are valid rules without channels", () => {
    for (const template of ruleTemplates("production")) {
      expect(validateRule(template.rule)).toEqual({});
      expect(template.rule.channelIds).toEqual([]);
      expect(template.rule.environment).toBe("production");
    }
  });

  it("names copies without colliding", () => {
    expect(copyName("错误率", ["错误率"])).toBe("错误率 副本");
    expect(copyName("错误率", ["错误率", "错误率 副本"])).toBe("错误率 副本 2");
  });

  it("explains delivery failures in words", () => {
    expect(deliveryErrorText("feishu_keyword_mismatch")).toContain("OpenRUM");
    expect(deliveryErrorText("http_404")).toBe("目标地址返回 HTTP 404");
    expect(deliveryErrorText("something_new")).toBe("发送失败");
    expect(deliveryErrorText(undefined)).toBe("发送失败");
  });
});
