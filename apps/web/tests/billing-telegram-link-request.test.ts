
import {
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    issueBillingTelegramLinkToken
  } from "../src/billing-telegram-link-request.js";

  const validToken =
    "A".repeat(42) + "E";

  function validResponse() {
    return {
      token: validToken,
      expiresAt: new Date(
        Date.now() + 60_000
      ).toISOString()
    };
  }

  describe("billing Telegram link request", () => {
    it("issues an authenticated POST request", async () => {
      const apiFetch = vi.fn(async () =>
        new Response(
          JSON.stringify(validResponse()),
          { status: 201 }
        )
      );

      const result = await issueBillingTelegramLinkToken({
        merchantId: "merchant-a",
        isCurrentRequest: () => true,
        apiFetch
      });

      expect(apiFetch).toHaveBeenCalledWith(
        "/merchants/merchant-a/billing-telegram/link-token",
        {
          method: "POST",
          cache: "no-store"
        }
      );

      expect(result?.token).toBe(validToken);
    });

    it("rejects a non-201 response", async () => {
      const apiFetch = vi.fn(async () =>
        new Response("{}", { status: 403 })
      );

      await expect(
        issueBillingTelegramLinkToken({
          merchantId: "merchant-a",
          isCurrentRequest: () => true,
          apiFetch
        })
      ).rejects.toThrow("Link token issuance failed");
    });

    it("rejects a malformed response", async () => {
      const apiFetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            token: "invalid",
            expiresAt: new Date(
              Date.now() + 60_000
            ).toISOString()
          }),
          { status: 201 }
        )
      );

      await expect(
        issueBillingTelegramLinkToken({
          merchantId: "merchant-a",
          isCurrentRequest: () => true,
          apiFetch
        })
      ).rejects.toThrow();
    });

    it("does not fetch when the request is already stale", async () => {
      const apiFetch = vi.fn();

      const result = await issueBillingTelegramLinkToken({
        merchantId: "merchant-a",
        isCurrentRequest: () => false,
        apiFetch
      });

      expect(result).toBeNull();
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("ignores a response after session invalidation", async () => {
      let resolveResponse!: (value: Response) => void;

      const pendingResponse = new Promise<Response>(
        (resolve) => {
          resolveResponse = resolve;
        }
      );

      const apiFetch = vi.fn(() => pendingResponse);

      let current = true;

      const request = issueBillingTelegramLinkToken({
        merchantId: "merchant-a",
        isCurrentRequest: () => current,
        apiFetch
      });

      current = false;

      resolveResponse(
        new Response(
          JSON.stringify(validResponse()),
          { status: 201 }
        )
      );

      expect(await request).toBeNull();
    });

    it("ignores a request invalidated during JSON parsing", async () => {
      let current = true;
      let resolveJson!: (value: unknown) => void;

      const pendingJson = new Promise<unknown>(
        (resolve) => {
          resolveJson = resolve;
        }
      );

      const apiFetch = vi.fn(async () =>
        ({
          status: 201,
          json: () => pendingJson
        }) as Response
      );

      const request = issueBillingTelegramLinkToken({
        merchantId: "merchant-a",
        isCurrentRequest: () => current,
        apiFetch
      });

      await vi.waitFor(() => {
        expect(apiFetch).toHaveBeenCalledTimes(1);
      });

      current = false;
      resolveJson(validResponse());

      expect(await request).toBeNull();
    });

    it("rejects an expired token", async () => {
      const apiFetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            token: validToken,
            expiresAt: new Date(
              Date.now() - 1_000
            ).toISOString()
          }),
          { status: 201 }
        )
      );

      await expect(
        issueBillingTelegramLinkToken({
          merchantId: "merchant-a",
          isCurrentRequest: () => true,
          apiFetch
        })
      ).rejects.toThrow(
        "Invalid billing Telegram link expiration"
      );
    });
  });
