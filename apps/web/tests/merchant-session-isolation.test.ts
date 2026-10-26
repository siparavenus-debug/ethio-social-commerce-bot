import { describe, expect, it } from "vitest";
import { createSessionGuard } from "../src/session-guard.js";

describe("merchant session isolation", () => {
  it("rejects an old session after another session becomes active", () => {
    const guard = createSessionGuard();

    guard.activate("merchant-a-token");
    const oldRequest = guard.capture();

    guard.activate("merchant-b-token");

    expect(guard.isCurrent(oldRequest)).toBe(false);
  });

  it("accepts requests belonging to the active session", () => {
    const guard = createSessionGuard();

    guard.activate("merchant-a-token");
    const request = guard.capture();

    expect(guard.isCurrent(request)).toBe(true);
  });

  it("invalidates outstanding requests on logout", () => {
    const guard = createSessionGuard();

    guard.activate("merchant-a-token");
    const request = guard.capture();

    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });

  it("invalidates old requests even when the same token is activated again", () => {
    const guard = createSessionGuard();

    guard.activate("merchant-a-token");
    const oldRequest = guard.capture();

    guard.invalidate();
    guard.activate("merchant-a-token");

    expect(guard.isCurrent(oldRequest)).toBe(false);
  });
});
