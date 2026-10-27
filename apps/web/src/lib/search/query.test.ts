import { describe, expect, it } from "vitest";
import {
  appendTerms,
  caretContext,
  highlight,
  queryTerms,
  replaceSpan,
  tokenize,
  writeShape,
} from "./query";

describe("query text", () => {
  it("keeps positions and ignores a written AND", () => {
    expect(tokenize('a:"x y" AND b:[1, 2]').map((token) => [token.text, token.start])).toEqual([
      ['a:"x y"', 0],
      ["AND", 8],
      ["b:[1, 2]", 12],
    ]);
    expect(queryTerms("a:1 AND b:2 c")).toEqual(["a:1", "b:2", "c"]);
    expect(appendTerms("a:1", ["b:2"])).toBe("a:1 AND b:2");
  });

  it("knows whether the caret is on a field name or a value", () => {
    expect(caretContext("us", 2)).toMatchObject({ kind: "field", prefix: "us" });
    expect(caretContext("!bro", 4)).toMatchObject({ kind: "field", prefix: "bro", negated: true });
    expect(caretContext("browser:Chr", 11)).toMatchObject({
      kind: "value",
      field: "browser",
      partial: "Chr",
    });
    expect(caretContext("browser:[Chrome,Saf", 19)).toMatchObject({
      kind: "value",
      inList: true,
      partial: "Saf",
    });
    expect(caretContext("route:*pay*", 9)).toMatchObject({ kind: "value", partial: "pay" });
    expect(caretContext("a:1 AND ", 8)).toMatchObject({ kind: "field", prefix: "" });
  });

  it("writes AND before a condition added after another", () => {
    expect(replaceSpan("a:1 ", 4, 4, "b:")).toEqual({ query: "a:1 AND b:", caret: 10 });
    expect(replaceSpan("a:1 AND ", 8, 8, "b:")).toEqual({ query: "a:1 AND b:", caret: 10 });
    expect(replaceSpan("", 0, 0, "b:")).toEqual({ query: "b:", caret: 2 });
    expect(replaceSpan("a:1 AND b:x", 8, 11, "b:y")).toEqual({ query: "a:1 AND b:y", caret: 11 });
  });

  it("writes each operator shape", () => {
    const shape = (
      label: string,
      negated: boolean,
      kind: "eq" | "in" | "contains" | "has" | "gt",
    ) => ({
      label,
      negated,
      shape: kind,
    });
    expect(writeShape("browser", shape("不是", true, "eq"), ["Chrome"])).toBe("!browser:Chrome");
    expect(writeShape("browser", shape("其中之一", false, "in"), ["A", "B C"])).toBe(
      'browser:[A,"B C"]',
    );
    expect(writeShape("route", shape("包含", false, "contains"), ["pay"])).toBe("route:*pay*");
    expect(writeShape("trace_id", shape("没有值", true, "has"), [])).toBe("!has:trace_id");
    expect(writeShape("duration", shape("大于", false, "gt"), ["2s"])).toBe("duration:>2s");
  });

  it("colours a query without losing a character", () => {
    const query = '!user.id:"a b" AND route:*pay* has:trace_id word status:>=500';
    const parts = highlight(query);
    expect(parts.map((part) => part.text).join("")).toBe(query);
    expect(parts.filter((part) => part.kind === "field").map((part) => part.text)).toEqual([
      "user.id",
      "route",
      "trace_id",
      "status",
    ]);
    expect(parts.find((part) => part.kind === "text")?.text).toBe("word");
  });
});
