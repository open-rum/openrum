// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserAvatar } from "./UserAvatar";

// Radix only shows the image once the browser reports it loaded, which jsdom never does.
function stubImages(outcome: "load" | "error") {
  class FakeImage {
    complete = false;
    naturalWidth = 0;
    referrerPolicy = "";
    crossOrigin: string | null = null;
    private listeners = new Map<string, Set<(event: unknown) => void>>();
    addEventListener(type: string, listener: (event: unknown) => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
    }
    removeEventListener(type: string, listener: (event: unknown) => void) {
      this.listeners.get(type)?.delete(listener);
    }
    set src(_value: string) {
      queueMicrotask(() => {
        // Radix reads these two to decide whether the picture really loaded.
        this.complete = true;
        this.naturalWidth = outcome === "load" ? 1 : 0;
        this.listeners.get(outcome)?.forEach((listener) => listener({ currentTarget: this }));
      });
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

beforeEach(() => stubImages("load"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UserAvatar", () => {
  it("shows initials when there is no picture", () => {
    const view = render(<UserAvatar userId="u1" name="Ada Lovelace" />);
    expect(view.getByText("AL")).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("shows a generated avatar without sending a referrer", async () => {
    const view = render(
      <UserAvatar userId="u1" name="Ada Lovelace" avatar="dicebear:thumbs:abc" />,
    );
    await waitFor(() => expect(view.container.querySelector("img")).not.toBeNull());
    const image = view.container.querySelector("img")!;
    expect(image.getAttribute("src")).toContain(
      "https://api.dicebear.com/10.x/thumbs/svg?seed=abc",
    );
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    // The name is printed next to it, so the image is decorative.
    expect(image.getAttribute("alt")).toBe("");
  });

  it("loads an uploaded picture from the API", async () => {
    const hash = "cd".repeat(16);
    const view = render(<UserAvatar userId="u1" name="Ada" avatar={`upload:${hash}`} />);
    await waitFor(() => expect(view.container.querySelector("img")).not.toBeNull());
    expect(view.container.querySelector("img")!.getAttribute("src")).toBe(
      `/api/v1/users/u1/avatar?v=${hash}`,
    );
  });

  it("falls back to initials when the picture does not load", async () => {
    stubImages("error");
    const view = render(
      <UserAvatar userId="u1" name="Ada Lovelace" avatar="dicebear:thumbs:abc" />,
    );
    await waitFor(() => expect(view.getByText("AL")).toBeTruthy());
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("ignores a reference it does not understand", () => {
    const view = render(
      <UserAvatar userId="u1" name="Ada Lovelace" avatar="https://evil.example/a.svg" />,
    );
    expect(view.getByText("AL")).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
  });
});
