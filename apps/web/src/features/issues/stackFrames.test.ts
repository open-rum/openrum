import { describe, expect, it } from "vitest";
import { parseRawStack, shortScriptPath } from "./stackFrames";

describe("parseRawStack", () => {
  it("reads Chrome frames with and without a function name", () => {
    const frames = parseRawStack(
      [
        "TypeError: x is undefined",
        "    at submit (https://cdn.example.com/assets/app-1a2b.js:50:37891)",
        "    at https://cdn.example.com/assets/app-1a2b.js:3:9",
        "    at Object.run (https://cdn.example.com/node_modules/.vite/deps/react-dom.js:12:4)",
      ].join("\n"),
    );
    expect(frames).toEqual([
      {
        function: "submit",
        url: "https://cdn.example.com/assets/app-1a2b.js",
        line: 50,
        column: 37891,
        library: false,
      },
      {
        function: undefined,
        url: "https://cdn.example.com/assets/app-1a2b.js",
        line: 3,
        column: 9,
        library: false,
      },
      {
        function: "Object.run",
        url: "https://cdn.example.com/node_modules/.vite/deps/react-dom.js",
        line: 12,
        column: 4,
        library: true,
      },
    ]);
  });

  it("reads Firefox and Safari frames", () => {
    expect(
      parseRawStack("submit@https://example.com/app.js:4:8\n@https://example.com/app.js:9:1"),
    ).toEqual([
      { function: "submit", url: "https://example.com/app.js", line: 4, column: 8, library: false },
      {
        function: undefined,
        url: "https://example.com/app.js",
        line: 9,
        column: 1,
        library: false,
      },
    ]);
  });

  it("ignores text that is not a frame", () => {
    expect(parseRawStack("Error: boom")).toEqual([]);
    expect(parseRawStack(undefined)).toEqual([]);
  });
});

describe("shortScriptPath", () => {
  it("drops the origin but keeps relative paths", () => {
    expect(shortScriptPath("https://cdn.example.com/assets/app.js")).toBe("assets/app.js");
    expect(shortScriptPath("checkout/coupon.js")).toBe("checkout/coupon.js");
  });
});
