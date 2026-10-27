// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  describeTerm,
  formatTerm,
  joinQuery,
  parseTerm,
  readRecentTerms,
  rememberTerm,
  searchErrorMessage,
  splitQuery,
} from "./terms";

describe("search terms", () => {
  it("splits on spaces outside quotes and lists", () => {
    expect(splitQuery('browser:[Chrome, "Mobile Safari"] user.id:"a b" timeout')).toEqual([
      'browser:[Chrome, "Mobile Safari"]',
      'user.id:"a b"',
      "timeout",
    ]);
    expect(joinQuery([])).toBeUndefined();
  });

  it("reads every operator the server reads", () => {
    expect(parseTerm("!route:/a")).toEqual({
      field: "route",
      negated: true,
      operator: "eq",
      values: ["/a"],
    });
    expect(parseTerm("browser:[Chrome,Safari]")?.values).toEqual(["Chrome", "Safari"]);
    expect(parseTerm("route:*pay*")?.operator).toBe("contains");
    expect(parseTerm("route:/api/*")?.operator).toBe("prefix");
    expect(parseTerm("route:*.js")?.operator).toBe("suffix");
    expect(parseTerm("trace_id:*")?.operator).toBe("has");
    expect(parseTerm("!has:trace_id")).toMatchObject({ negated: true, operator: "has" });
    expect(parseTerm("status:>=500")).toMatchObject({ operator: "gte", values: ["500"] });
    expect(parseTerm('route:"*literal*"')).toMatchObject({ operator: "eq", values: ["*literal*"] });
    expect(parseTerm("https://example.com")).toMatchObject({ field: "", operator: "contains" });
    for (const refused of ["OR", "route:", "route:a*b", "browser:[a"])
      expect(parseTerm(refused)).toBeUndefined();
  });

  it("writes terms the parser reads back unchanged", () => {
    for (const raw of [
      "!route:/a",
      "browser:[Chrome,Safari]",
      "route:*pay*",
      "has:trace_id",
      "duration:>2s",
      'user.id:"customer 1"',
      'attributes.plan:["a b",c]',
    ]) {
      const term = parseTerm(raw)!;
      expect(parseTerm(formatTerm(term))).toEqual(term);
    }
  });

  it("describes a term in words", () => {
    const label = (field: string) => ({ browser: "浏览器", duration: "耗时" })[field] ?? field;
    expect(describeTerm(parseTerm("!browser:Chrome")!, label)).toBe("浏览器 不是 Chrome");
    expect(describeTerm(parseTerm("duration:>2s")!, label)).toBe("耗时 > 2s");
    expect(describeTerm(parseTerm("browser:[A,B]")!, label)).toBe("浏览器 属于 A、B");
    expect(describeTerm(parseTerm("!has:trace_id")!, label)).toBe("trace_id 没有值");
    expect(describeTerm(parseTerm("timeout")!, label, "错误标题")).toBe("错误标题 包含 timeout");
  });

  it("explains the server's refusals", () => {
    expect(searchErrorMessage("boolean_keyword")).toContain("字段:[值1,值2]");
    expect(searchErrorMessage("unknown_field", "plan:pro")).toContain("「plan:pro」");
    expect(searchErrorMessage("something new")).toBe("搜索条件无效。");
  });
});

describe("recent searches", () => {
  afterEach(() => window.localStorage.clear());

  it("keeps the latest ten per page, newest first, without duplicates", () => {
    for (let index = 0; index < 12; index += 1) rememberTerm("logs", `term-${index}`);
    rememberTerm("logs", "term-5");
    const recent = readRecentTerms("logs");
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe("term-5");
    expect(new Set(recent).size).toBe(10);
    expect(readRecentTerms("issues")).toEqual([]);
  });

  it("survives storage that is broken", () => {
    window.localStorage.setItem("openrum:recent-search:logs", "{not json");
    expect(readRecentTerms("logs")).toEqual([]);
  });
});
