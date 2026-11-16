// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { MockDataNotice } from "./MockDataNotice";

function Harness() {
  const [enabled, setEnabled] = useState(false);
  return <MockDataNotice enabled={enabled} onChange={setEnabled} />;
}

describe("MockDataNotice", () => {
  it("switches preview data on and says so while it shows", () => {
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "使用模拟数据" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("当前显示模拟数据")).toBeTruthy();
  });
});
