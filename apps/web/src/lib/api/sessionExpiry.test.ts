// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { isSessionExpired } from "@/lib/auth/session";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  redirectToLogin: redirect,
}));

import { requestJSON, requestNoContent } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  redirect.mockClear();
});

function reply(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}
const envelope = (code: string) => ({ error: { code, message: "x", requestId: "r" } });

describe("what counts as an expired sign-in", () => {
  it("is a 401 for a missing session or with no readable code", () => {
    expect(isSessionExpired(401, "UNAUTHENTICATED")).toBe(true);
    expect(isSessionExpired(401)).toBe(true);
  });

  it("is not a 401 asking for the password again, nor any other status", () => {
    expect(isSessionExpired(401, "REAUTHENTICATION_REQUIRED")).toBe(false);
    expect(isSessionExpired(401, "REAUTHENTICATION_FAILED")).toBe(false);
    expect(isSessionExpired(401, "INVALID_UPLOAD_TOKEN")).toBe(false);
    expect(isSessionExpired(403, "UNAUTHENTICATED")).toBe(false);
  });
});

describe("the API client", () => {
  it("sends a person with no session back to sign in", async () => {
    reply(401, envelope("UNAUTHENTICATED"));
    await expect(requestJSON(z.object({}), "/api/v1/x")).rejects.toMatchObject({ status: 401 });
    expect(redirect).toHaveBeenCalledWith(true);
  });

  it("keeps a signed-in person on the page when the password they typed was wrong", async () => {
    reply(401, envelope("REAUTHENTICATION_FAILED"));
    await expect(requestJSON(z.object({}), "/api/v1/auth/reauthenticate")).rejects.toMatchObject({
      status: 401,
      code: "REAUTHENTICATION_FAILED",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does the same for requests without a response body", async () => {
    reply(401, envelope("REAUTHENTICATION_REQUIRED"));
    await expect(requestNoContent("/api/v1/x", { method: "DELETE" })).rejects.toMatchObject({
      code: "REAUTHENTICATION_REQUIRED",
    });
    expect(redirect).not.toHaveBeenCalled();
    reply(401, envelope("UNAUTHENTICATED"));
    await expect(requestNoContent("/api/v1/x", { method: "DELETE" })).rejects.toBeTruthy();
    expect(redirect).toHaveBeenCalledWith(true);
  });
});
