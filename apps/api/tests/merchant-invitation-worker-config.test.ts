import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  reconcile: vi.fn(),
  processNext: vi.fn(),
  disconnect: vi.fn()
}));

vi.mock("@ethio-commerce/database", () => ({
  prisma: {
    $disconnect: mocks.disconnect
  }
}));

vi.mock(
  "../src/services/merchant-invitation-delivery.js",
  () => ({
    cleanupExpiredMerchantInvitations: mocks.cleanup,
    reconcileStaleMerchantInvitationSending: mocks.reconcile
  })
);

vi.mock(
  "../src/services/merchant-invitation-processor.js",
  () => ({
    processNextMerchantInvitation: mocks.processNext
  })
);

describe("merchant invitation worker configuration", () => {
  it("initializes without unrelated API secrets", async () => {
    mocks.cleanup.mockResolvedValue(0);
    mocks.reconcile.mockResolvedValue(0);
    mocks.processNext.mockResolvedValue(false);
    mocks.disconnect.mockResolvedValue(undefined);

    const original = { ...process.env };

    try {
      process.env.RESEND_API_KEY = "test-resend-key";
      process.env.RESEND_FROM_EMAIL =
        "test@example.com";
      process.env.MERCHANT_ACTIVATION_BASE_URL =
        "https://example.com/activate";
      process.env.MERCHANT_INVITATION_ENCRYPTION_KEY =
        "test-only-merchant-invitation-encryption-key-2026";

      delete process.env.AUTH_SECRET;
      delete process.env.PLATFORM_AUTH_SECRET;
      delete process.env.DELIVERY_CONFIRMATION_SECRET;
      delete process.env.TELEGRAM_CREDENTIAL_ENCRYPTION_KEY;

      await import(
        "../src/scripts/process-merchant-invitations.js"
      );

      await vi.waitFor(() => {
        expect(mocks.disconnect).toHaveBeenCalledOnce();
      });

      expect(mocks.cleanup).toHaveBeenCalledOnce();
      expect(mocks.reconcile).toHaveBeenCalledOnce();
      expect(mocks.processNext).toHaveBeenCalledOnce();
      expect(mocks.processNext).toHaveBeenCalledWith({
        apiKey: "test-resend-key",
        fromEmail: "test@example.com",
        activationBaseUrl: "https://example.com/activate"
      });
    } finally {
      process.env = original;
    }
  });
});