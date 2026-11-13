// @vitest-environment jsdom

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

function Segmented({ initial = "a" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ToggleGroup type="single" variant="segmented" value={value} onValueChange={setValue}>
      <ToggleGroupItem value="a">甲</ToggleGroupItem>
      <ToggleGroupItem value="b">乙</ToggleGroupItem>
    </ToggleGroup>
  );
}

const thumb = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="toggle-group-thumb"]');

describe("segmented ToggleGroup", () => {
  it("draws a hidden-from-assistive-tech thumb behind the selected option", async () => {
    const { container } = render(<Segmented />);
    const element = thumb(container);
    expect(element).not.toBeNull();
    expect(element?.getAttribute("aria-hidden")).toBe("true");
    expect(element?.style.opacity).toBe("1");

    fireEvent.click(screen.getByRole("radio", { name: "乙" }));
    await act(async () => {});
    expect(screen.getByRole("radio", { name: "乙" }).getAttribute("data-state")).toBe("on");
    expect(element?.style.opacity).toBe("1");
  });

  it("hides the thumb when nothing is selected", () => {
    const { container } = render(<Segmented initial="" />);
    expect(thumb(container)?.style.opacity).toBe("0");
  });

  it("adds no thumb to other variants", () => {
    const { container } = render(
      <ToggleGroup type="multiple" variant="outline">
        <ToggleGroupItem value="a">甲</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(thumb(container)).toBeNull();
  });
});
