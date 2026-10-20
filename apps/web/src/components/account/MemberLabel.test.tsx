// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemberLabel } from "./MemberLabel";

afterEach(cleanup);

describe("MemberLabel", () => {
  it("prints the name next to the picture", () => {
    const view = render(
      <MemberLabel
        member={{ userId: "u1", displayName: "Ada Lovelace", email: "ada@example.test" }}
      />,
    );
    expect(view.getByText("Ada Lovelace")).toBeTruthy();
    // Without a picture the initials stand in for it.
    expect(view.getByText("AL")).toBeTruthy();
  });

  it("falls back to the email when the member has no name", () => {
    const view = render(
      <MemberLabel member={{ userId: "u2", displayName: "", email: "grace@example.test" }} />,
    );
    expect(view.getByText("grace@example.test")).toBeTruthy();
    expect(view.getByText("G")).toBeTruthy();
  });
});
