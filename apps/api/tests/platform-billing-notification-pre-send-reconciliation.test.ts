
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    prisma
  } from "@ethio-commerce/database";

  import {
    lockPlatformBillingMerchant
  } from "../src/services/platform-billing-merchant-lock.js";

  import {
    validatePlatformBillingRequestStart
  } from "../src/services/platform-billing-notification-pre-send.js";

  import {
    reconcilePlatformBillingFailedPreSendAttempt
  } from "../src/services/platform-billing-notification-pre-send-reconciliation.js";

  vi.mock("@ethio-commerce/database", () => ({
    Prisma: {
      TransactionIsolationLevel: {
        ReadCommitted: "ReadCommitted"
      }
    },
    prisma: {
      $transaction: vi.fn()
    }
  }));

  vi.mock(
    "../src/services/platform-billing-merchant-lock.js",
    () => ({
      lockPlatformBillingMerchant: vi.fn()
    })
  );

  vi.mock(
    "../src/services/platform-billing-notification-pre-send.js",
    () => ({
      validatePlatformBillingRequestStart: vi.fn()
    })
  );

  const transactionMock = vi.mocked(prisma.$transaction);
  const lockMock = vi.mocked(lockPlatformBillingMerchant);
  const eligibilityMock = vi.mocked(
    validatePlatformBillingRequestStart
  );

  const deliveryId = "delivery-a";
  const claimId = "claim-a";
  const attemptId = "attempt-a";
  const merchantId = "merchant-a";

  function makeDelivery(overrides: Record<string, unknown> = {}) {
    return {
      merchantId,
      status: "SENDING",
      claimId,
      processingUntil: new Date(Date.now() + 60_000),
      attemptCount: 1,
      notificationId: "notification-a",
      notification: {
        status: "PENDING"
      },
      attempts: [
        {
          id: attemptId,
          merchantId,
          claimId,
          attemptNumber: 1,
          outcome: "PREPARED",
          requestStartedAt: null
        }
      ],
      ...overrides
    };
  }

  function makeHarness(
    delivery: ReturnType<typeof makeDelivery> | null =
      makeDelivery()
  ) {
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ merchantId })
      .mockResolvedValueOnce(delivery);

    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ id: attemptId }])
      .mockResolvedValueOnce([
        { notificationId: "notification-a" }
      ]);

    const updateMany = vi.fn()
      .mockResolvedValue({ count: 1 });

    const tx = {
      platformBillingNotificationDelivery: {
        findUnique
      },
      platformBillingNotification: {
        updateMany
      },
      $queryRaw: queryRaw
    };

    transactionMock.mockImplementation(
      (async (callback: (tx: typeof tx) => unknown) =>
        callback(tx)) as never
    );

    return {
      tx,
      findUnique,
      queryRaw,
      updateMany
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();

    eligibilityMock.mockResolvedValue({
      eligible: true,
      sendAuthorized: false
    });
  });

  describe("B7.4-C4-A pre-send reconciliation", () => {
    it("rejects invalid input without opening a transaction", async () => {
      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          "",
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result).toEqual({
        reconciled: false,
        sendAuthorized: false,
        reason: "INVALID_RECONCILIATION_INPUT"
      });

      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("rejects a missing delivery", async () => {
      const harness = makeHarness();

      harness.findUnique
        .mockReset()
        .mockResolvedValue(null);

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result).toMatchObject({
        reconciled: false,
        reason: "DELIVERY_NOT_FOUND"
      });

      expect(harness.queryRaw).not.toHaveBeenCalled();
    });

    it("rejects an incorrect claim", async () => {
      const harness = makeHarness(
        makeDelivery({ claimId: "different-claim" })
      );

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result).toMatchObject({
        reconciled: false,
        reason: "CLAIM_MISMATCH"
      });

      expect(harness.queryRaw).not.toHaveBeenCalled();
    });

    it("rejects a delivery that is not SENDING", async () => {
      const harness = makeHarness(
        makeDelivery({ status: "PROCESSING" })
      );

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result).toMatchObject({
        reconciled: false,
        reason: "DELIVERY_NOT_SENDING"
      });

      expect(harness.queryRaw).not.toHaveBeenCalled();
    });

    it("rejects an already-started attempt", async () => {
      const harness = makeHarness(
        makeDelivery({
          attempts: [{
            id: attemptId,
            merchantId,
            claimId,
            attemptNumber: 1,
            outcome: "REQUEST_STARTED",
            requestStartedAt: new Date()
          }]
        })
      );

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result).toMatchObject({
        reconciled: false,
        reason: "ATTEMPT_NOT_PREPARED"
      });

      expect(harness.queryRaw).not.toHaveBeenCalled();
    });

    it("rejects conflicting unresolved attempts", async () => {
      const harness = makeHarness(
        makeDelivery({
          attempts: [
            {
              id: attemptId,
              merchantId,
              claimId,
              attemptNumber: 2,
              outcome: "PREPARED",
              requestStartedAt: null
            },
            {
              id: "older-attempt",
              merchantId,
              claimId: "older-claim",
              attemptNumber: 1,
              outcome: "UNCERTAIN",
              requestStartedAt: new Date()
            }
          ],
          attemptCount: 2
        })
      );

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result).toMatchObject({
        reconciled: false,
        reason: "CONFLICTING_UNRESOLVED_ATTEMPT"
      });

      expect(harness.queryRaw).not.toHaveBeenCalled();
    });

    it("reconciles a recoverable failure to PENDING", async () => {
      const harness = makeHarness();

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result).toEqual({
        reconciled: true,
        sendAuthorized: false,
        deliveryStatus: "PENDING"
      });

      expect(lockMock).toHaveBeenCalledWith(
        harness.tx,
        merchantId
      );

      expect(eligibilityMock).toHaveBeenCalledWith(
        harness.tx,
        deliveryId
      );

      expect(harness.queryRaw).toHaveBeenCalledTimes(2);
      expect(harness.updateMany).not.toHaveBeenCalled();
    });

    it("reconciles permanent failure to REVIEW_REQUIRED", async () => {
      const harness = makeHarness();

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "PERMANENT_PRE_SEND"
        );

      expect(result).toEqual({
        reconciled: true,
        sendAuthorized: false,
        deliveryStatus: "REVIEW_REQUIRED"
      });

      expect(harness.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "REVIEW_REQUIRED"
          })
        })
      );
    });

    it.each([
      ["SUPPRESS", "SUPPRESSED"],
      ["DEFER", "PENDING"],
      ["REVIEW_REQUIRED", "REVIEW_REQUIRED"]
    ] as const)(
      "honors fresh %s eligibility",
      async (disposition, expectedStatus) => {
        const harness = makeHarness();

        eligibilityMock.mockResolvedValue({
          eligible: false,
          disposition,
          reason: "ELIGIBILITY_CHANGED"
        });

        const result =
          await reconcilePlatformBillingFailedPreSendAttempt(
            deliveryId,
            claimId,
            attemptId,
            "RECOVERABLE_PRE_SEND"
          );

        expect(result).toMatchObject({
          reconciled: true,
          sendAuthorized: false,
          deliveryStatus: expectedStatus
        });

        expect(harness.queryRaw).toHaveBeenCalledTimes(2);
      }
    );

    it("rejects when attempt conditional update fails", async () => {
      const harness = makeHarness();

      harness.queryRaw
        .mockReset()
        .mockResolvedValueOnce([]);

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result).toMatchObject({
        reconciled: false,
        reason: "ATTEMPT_CONDITIONAL_UPDATE_FAILED"
      });

      expect(harness.queryRaw).toHaveBeenCalledTimes(1);
    });

    it("throws when delivery update fails", async () => {
      const harness = makeHarness();

      harness.queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ id: attemptId }])
        .mockResolvedValueOnce([]);

      await expect(
        reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        )
      ).rejects.toThrow(
        "DELIVERY_RECONCILIATION_CONDITIONAL_UPDATE_FAILED"
      );
    });

    it("throws when notification update fails", async () => {
      const harness = makeHarness();

      harness.updateMany.mockResolvedValue({
        count: 0
      });

      await expect(
        reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "PERMANENT_PRE_SEND"
        )
      ).rejects.toThrow(
        "NOTIFICATION_RECONCILIATION_CONDITIONAL_UPDATE_FAILED"
      );
    });

    it("never authorizes Telegram sending", async () => {
      makeHarness();

      const result =
        await reconcilePlatformBillingFailedPreSendAttempt(
          deliveryId,
          claimId,
          attemptId,
          "RECOVERABLE_PRE_SEND"
        );

      expect(result.sendAuthorized).toBe(false);
    });
  });
