// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeAxisTick, VALUE_LABEL_MIN_WIDTH, ValueAxisTick } from "./axisTicks";

const svg = (node: React.ReactNode) => render(<svg>{node}</svg>).container.querySelector("text")!;
const box = (node: React.ReactNode) => render(<svg>{node}</svg>).container.querySelector("rect")!;

describe("chart axis ticks", () => {
  it("draws value labels level with their gridline, against the plot, the unit on the top one", () => {
    const top = svg(
      <ValueAxisTick
        x={40}
        y={20}
        payload={{ value: 2000 }}
        index={2}
        visibleTicksCount={3}
        side="left"
        unit="ms"
      />,
    );
    expect(top.textContent).toBe("2,000 ms");
    expect(top.getAttribute("y")).toBe("20");
    expect(top.getAttribute("text-anchor")).toBe("end");
    // Recharts sizes the axis column from elements of this class.
    expect(top.classList.contains("recharts-cartesian-axis-tick-value")).toBe(true);

    const zero = svg(
      <ValueAxisTick
        x={40}
        y={200}
        payload={{ value: 0 }}
        index={0}
        visibleTicksCount={3}
        side="left"
        unit="ms"
      />,
    );
    expect(zero.textContent).toBe("0");

    const right = svg(
      <ValueAxisTick
        x={600}
        y={20}
        payload={{ value: 0.25 }}
        index={0}
        visibleTicksCount={3}
        side="right"
      />,
    );
    expect(right.getAttribute("text-anchor")).toBe("start");
  });

  it("keeps the label column at least a fixed width, so plots line up across charts", () => {
    const tick = (side: "left" | "right") =>
      box(
        <ValueAxisTick
          x={40}
          y={20}
          payload={{ value: 4 }}
          index={1}
          visibleTicksCount={3}
          side={side}
        />,
      );
    // Recharts reads the column's width from elements of this class.
    expect(tick("left").classList.contains("recharts-cartesian-axis-tick-value")).toBe(true);
    expect(tick("left").getAttribute("width")).toBe(String(VALUE_LABEL_MIN_WIDTH));
    // The box reaches away from the plot on either side.
    expect(tick("left").getAttribute("x")).toBe(String(40 - VALUE_LABEL_MIN_WIDTH));
    expect(tick("right").getAttribute("x")).toBe("40");
  });

  it("centres time labels under their bucket and aligns only those that would be cut off", () => {
    const at = (x: number) =>
      svg(
        <TimeAxisTick
          x={x}
          y={0}
          width={600}
          payload={{ value: "11/05" }}
          index={0}
          visibleTicksCount={4}
        />,
      ).getAttribute("text-anchor");
    expect(at(4)).toBe("start");
    // The first visible label away from the edge stays under its bucket.
    expect(at(200)).toBe("middle");
    expect(at(596)).toBe("end");
  });
});
