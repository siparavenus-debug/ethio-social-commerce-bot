import { afterEach, describe, expect, it, vi } from "vitest";
import { platformRequest, PlatformApiError, PLATFORM_SESSION_KEY } from "../src/platform-api";

afterEach(() => vi.unstubAllGlobals());
describe("platform API boundary", () => {
  it("uses a distinct platform session key", () => {
    expect(PLATFORM_SESSION_KEY).not.toBe("ethio-commerce-auth");
  });
  it("sends only the supplied platform token to platform routes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ merchants: [] })));
    vi.stubGlobal("fetch", fetch);
    await platformRequest("/merchants", "platform-token");
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/platform\/merchants$/), expect.objectContaining({ headers: { Authorization: "Bearer platform-token" }, method: "GET" }));
  });
  it("does not attach authorization to login", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "token" })));
    vi.stubGlobal("fetch", fetch);
    await platformRequest("/auth/login", "", "POST", { email: "operator@example.test", password: "test" });
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ email: "operator@example.test", password: "test" });
  });
  it("preserves unauthorized status for session expiry handling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Expired session" }), { status: 401 })));
    await expect(platformRequest("/auth/me", "expired")).rejects.toMatchObject({ status: 401, message: "Expired session" });
  });
  it("reports non-JSON server failures without exposing response markup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Gateway error</html>", { status: 502 })));
    await expect(platformRequest("/plans", "token")).rejects.toBeInstanceOf(PlatformApiError);
  });
});
