
import {
    describe,
    expect,
    it
  } from "vitest";

  import {
    validateBillingTelegramLinkTokenResponse
  } from "../src/billing-telegram-link-token.js";

  describe("billing Telegram link token validation", () => {
    const now = Date.parse("2026-11-06T12:00:00.000Z");

    const validToken =
      "A".repeat(42) + "E";

    const validResponse = () => ({
      token: validToken,
      expiresAt: new Date(
        now + 10 * 60 * 1000
      ).toISOString()
    });

    it("accepts a valid token and expiration", () => {
      expect(
        validateBillingTelegramLinkTokenResponse(
          validResponse(),
          now
        )
      ).toEqual(validResponse());
    });

    it.each([
      null,
      undefined,
      "",
      [],
      {},
      { token: validToken },
      { expiresAt: validResponse().expiresAt },
      { token: 123, expiresAt: validResponse().expiresAt },
      { token: validToken, expiresAt: 123 }
    ])("rejects malformed response: %s", (value) => {
      expect(() =>
        validateBillingTelegramLinkTokenResponse(
          value,
          now
        )
      ).toThrow();
    });

    it.each([
      "",
      "short",
      "A".repeat(42),
      "A".repeat(44),
      "A".repeat(42) + "+",
      "A".repeat(42) + "/",
      "A".repeat(42) + "=",
      "A".repeat(42) + "B"
    ])("rejects invalid token format", (token) => {
      expect(() =>
        validateBillingTelegramLinkTokenResponse(
          {
            ...validResponse(),
            token
          },
          now
        )
      ).toThrow();
    });

    it("rejects an expired token", () => {
      expect(() =>
        validateBillingTelegramLinkTokenResponse(
          {
            ...validResponse(),
            expiresAt: new Date(now - 1).toISOString()
          },
          now
        )
      ).toThrow();
    });

    it("rejects a token expiring exactly now", () => {
      expect(() =>
        validateBillingTelegramLinkTokenResponse(
          {
            ...validResponse(),
            expiresAt: new Date(now).toISOString()
          },
          now
        )
      ).toThrow();
    });

    it("rejects expiration beyond ten minutes", () => {
      expect(() =>
        validateBillingTelegramLinkTokenResponse(
          {
            ...validResponse(),
            expiresAt: new Date(
              now + 10 * 60 * 1000 + 1
            ).toISOString()
          },
          now
        )
      ).toThrow();
    });

    it("rejects invalid expiration timestamps", () => {
      expect(() =>
        validateBillingTelegramLinkTokenResponse(
          {
            ...validResponse(),
            expiresAt: "not-a-date"
          },
          now
        )
      ).toThrow();
    });

    it("rejects invalid current time", () => {
      expect(() =>
        validateBillingTelegramLinkTokenResponse(
          validResponse(),
          Number.NaN
        )
      ).toThrow();
    });
  });
