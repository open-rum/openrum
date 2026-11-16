// @vitest-environment jsdom

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ToggleGroup, ToggleGroupItem, type ToggleGroupColor } from "./toggle-group";

function Segmented({ initial = "a", color }: { initial?: string; color?: ToggleGroupColor }) {
  const [value, setValue] = useState(initial);
  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      color={color}
      value={value}
      onValueChange={setValue}
    >
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
    expect(element?.parentElement?.style.getPropertyValue("--segmented-color")).toBe(
      "var(--color-primary)",
    );

    fireEvent.click(screen.getByRole("radio", { name: "乙" }));
    await act(async () => {});
    expect(screen.getByRole("radio", { name: "乙" }).getAttribute("data-state")).toBe("on");
    expect(element?.style.opacity).toBe("1");
  });

  it("updates the colour pair without resetting the selection or overriding caller styles", () => {
    const view = render(<Segmented color="secondary" />);
    fireEvent.click(within(view.container).getByRole("radio", { name: "乙" }));
    view.rerender(<Segmented color="warning" />);
    const group = within(view.container).getByRole("radiogroup");
    expect(group.style.getPropertyValue("--segmented-color")).toBe("var(--color-warning)");
    expect(group.style.getPropertyValue("--segmented-content")).toBe(
      "var(--color-warning-content)",
    );
    expect(within(group).getByRole("radio", { name: "乙" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    view.rerender(
      <ToggleGroup type="single" variant="outline" color="error" style={{ marginTop: 4 }} value="a">
        <ToggleGroupItem value="a">甲</ToggleGroupItem>
      </ToggleGroup>,
    );
    const styled = within(view.container).getByRole("radiogroup");
    expect(styled.style.marginTop).toBe("4px");
    expect(styled.style.getPropertyValue("--segmented-color")).toBe("var(--color-error)");
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
