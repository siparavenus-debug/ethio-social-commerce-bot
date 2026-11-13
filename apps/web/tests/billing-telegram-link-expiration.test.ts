
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    scheduleBillingTelegramLinkExpiration
  } from "../src/billing-telegram-link-expiration.js";

  describe("billing Telegram link expiration scheduler", () => {
    const now = Date.parse("2026-11-06T12:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("expires a token at its deadline", () => {
      const onExpire = vi.fn();

      const cancel = scheduleBillingTelegramLinkExpiration(
        new Date(now + 60_000).toISOString(),
        onExpire
      );

      vi.advanceTimersByTime(59_999);
      expect(onExpire).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onExpire).toHaveBeenCalledTimes(1);

      cancel();
    });

    it("expires an already expired token immediately", () => {
      const onExpire = vi.fn();

      scheduleBillingTelegramLinkExpiration(
        new Date(now - 1).toISOString(),
        onExpire
      );

      expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it("expires a token whose deadline is now", () => {
      const onExpire = vi.fn();

      scheduleBillingTelegramLinkExpiration(
        new Date(now).toISOString(),
        onExpire
      );

      expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid expiration timestamp", () => {
      const onExpire = vi.fn();

      scheduleBillingTelegramLinkExpiration(
        "not-a-date",
        onExpire
      );

      expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it("cancels expiration when cleanup runs", () => {
      const onExpire = vi.fn();

      const cancel = scheduleBillingTelegramLinkExpiration(
        new Date(now + 60_000).toISOString(),
        onExpire
      );

      cancel();

      vi.advanceTimersByTime(60_000);

      expect(onExpire).not.toHaveBeenCalled();
    });

    it("does not expire an old token after replacement", () => {
      const oldExpire = vi.fn();
      const newExpire = vi.fn();

      const cancelOld = scheduleBillingTelegramLinkExpiration(
        new Date(now + 30_000).toISOString(),
        oldExpire
      );

      cancelOld();

      const cancelNew = scheduleBillingTelegramLinkExpiration(
        new Date(now + 60_000).toISOString(),
        newExpire
      );

      vi.advanceTimersByTime(30_000);

      expect(oldExpire).not.toHaveBeenCalled();
      expect(newExpire).not.toHaveBeenCalled();

      vi.advanceTimersByTime(30_000);

      expect(newExpire).toHaveBeenCalledTimes(1);

      cancelNew();
    });

    it("rejects an invalid current timestamp", () => {
      const onExpire = vi.fn();

      scheduleBillingTelegramLinkExpiration(
        new Date(now + 60_000).toISOString(),
        onExpire,
        Number.NaN
      );

      expect(onExpire).toHaveBeenCalledTimes(1);
    });
  });
