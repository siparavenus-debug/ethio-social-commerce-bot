import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

import {
  beginMerchantInvitationSending,
  claimMerchantInvitationDelivery,
  completeMerchantInvitationDelivery,
  failMerchantInvitationDelivery,
  cleanupExpiredMerchantInvitations,
  isMerchantInvitationReadyToSend,
  reconcileStaleMerchantInvitationSending,
  requireMerchantInvitationDeliveryReview
} from "../src/services/merchant-invitation-delivery.js";

import { vi } from "vitest";

import {
  encryptMerchantInvitation
} from "../src/services/merchant-invitation-encryption.js";

import {
  processNextMerchantInvitation
} from "../src/services/merchant-invitation-processor.js";

const testPrefix = "merchant-invitation-worker";

async function cleanup(): Promise<void> {
  const merchants = await prisma.merchant.findMany({
    where: {
      name: {
        startsWith: testPrefix
      }
    },
    select: {
      id: true
    }
  });

  const merchantIds = merchants.map(
    (merchant) => merchant.id
  );

  if (merchantIds.length === 0) {
    return;
  }

  await prisma.merchantInvitationDelivery.deleteMany({
    where: {
      activation: {
        merchantId: {
          in: merchantIds
        }
      }
    }
  });

  await prisma.merchantOwnerActivation.deleteMany({
    where: {
      merchantId: {
        in: merchantIds
      }
    }
  });

  await prisma.merchant.deleteMany({
    where: {
      id: {
        in: merchantIds
      }
    }
  });
}

async function createFixture() {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `${testPrefix}-${suffix}`,
      currency: "ETB"
    }
  });

  const activation =
    await prisma.merchantOwnerActivation.create({
      data: {
        merchantId: merchant.id,
        ownerEmail: `owner-${suffix}@example.test`,
        tokenHash: suffix.replace(/-/g, ""),
        expiresAt: new Date(
          Date.now() + 60 * 60 * 1000
        )
      }
    });

  const delivery =
    await prisma.merchantInvitationDelivery.create({
      data: {
        activationId: activation.id,
        recipientEmail: activation.ownerEmail,
        encryptedToken: "encrypted-test-token",
        status: "PENDING"
      }
    });

  return { merchant, activation, delivery };
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("merchant invitation delivery worker", () => {
  it("marks a claimed invitation as SENDING before external delivery", async () => {
    const { delivery } = await createFixture();

    const claim = await claimMerchantInvitationDelivery();

    expect(claim).not.toBeNull();
    expect(claim!.id).toBe(delivery.id);

    const started = await beginMerchantInvitationSending({
      deliveryId: delivery.id,
      attemptCount: claim!.attemptCount
    });

    expect(started).toBe(true);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("SENDING");
    expect(persisted.attemptCount).toBe(1);
    expect(persisted.processingUntil).toBeInstanceOf(Date);
    expect(persisted.sentAt).toBeNull();

    const secondClaim =
      await claimMerchantInvitationDelivery();

    expect(secondClaim).toBeNull();

    const duplicateStart =
      await beginMerchantInvitationSending({
        deliveryId: delivery.id,
        attemptCount: claim!.attemptCount
      });

    expect(duplicateStart).toBe(false);
  });

  it("moves stale SENDING deliveries to manual review without retrying", async () => {
    const { delivery } = await createFixture();

    const claim = await claimMerchantInvitationDelivery();

    expect(claim).not.toBeNull();

    const started = await beginMerchantInvitationSending({
      deliveryId: delivery.id,
      attemptCount: claim!.attemptCount
    });

    expect(started).toBe(true);

    // Simulate an expired processing lease after a worker crash.
    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        processingUntil: new Date(Date.now() - 60_000)
      }
    });

    const reconciled =
      await reconcileStaleMerchantInvitationSending();

    expect(reconciled).toBe(1);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("REVIEW_REQUIRED");
    expect(persisted.processingUntil).toBeNull();
    expect(persisted.attemptCount).toBe(1);
    expect(persisted.sentAt).toBeNull();
    expect(persisted.providerMessageId).toBeNull();
    expect(persisted.encryptedToken).not.toBeNull();

    // Reconciliation must not make the delivery retryable.
    const nextClaim =
      await claimMerchantInvitationDelivery();

    expect(nextClaim).toBeNull();

    // Repeated reconciliation must not change the result.
    const secondReconciliation =
      await reconcileStaleMerchantInvitationSending();

    expect(secondReconciliation).toBe(0);
  });

  it("accepts a delayed provider confirmation after reconciliation", async () => {
    const { delivery } = await createFixture();

    const claim = await claimMerchantInvitationDelivery();

    expect(claim).not.toBeNull();

    const started = await beginMerchantInvitationSending({
      deliveryId: delivery.id,
      attemptCount: claim!.attemptCount
    });

    expect(started).toBe(true);

    // Simulate the original worker's lease expiring.
    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        processingUntil: new Date(Date.now() - 60_000)
      }
    });

    const reconciled =
      await reconcileStaleMerchantInvitationSending();

    expect(reconciled).toBe(1);

    // The original worker receives Resend's acceptance afterward.
    const completed = await completeMerchantInvitationDelivery({
      deliveryId: delivery.id,
      attemptCount: claim!.attemptCount,
      providerMessageId: "resend-delayed-confirmation"
    });

    expect(completed).toBe(true);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("SENT");
    expect(persisted.providerMessageId).toBe(
      "resend-delayed-confirmation"
    );
    expect(persisted.sentAt).toBeInstanceOf(Date);
    expect(persisted.processingUntil).toBeNull();
    expect(persisted.encryptedToken).toBeNull();
    expect(persisted.lastError).toBeNull();
    expect(persisted.attemptCount).toBe(1);

    // Completion must not be applied twice.
    const duplicateCompletion =
      await completeMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: claim!.attemptCount,
        providerMessageId: "resend-delayed-confirmation"
      });

    expect(duplicateCompletion).toBe(false);

    // The completed invitation cannot be claimed again.
    const nextClaim = await claimMerchantInvitationDelivery();

    expect(nextClaim).toBeNull();
  });


  it("claims an eligible invitation once while its lease is active", async () => {
    const { delivery } = await createFixture();

    const first =
      await claimMerchantInvitationDelivery();

    expect(first?.id).toBe(delivery.id);
    expect(first?.status).toBe("PROCESSING");
    expect(first?.attemptCount).toBe(1);
    expect(first?.processingUntil).toBeInstanceOf(Date);
    expect(
      first!.processingUntil!.getTime()
    ).toBeGreaterThan(Date.now());

    const second =
      await claimMerchantInvitationDelivery();

    expect(second).toBeNull();

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("PROCESSING");
    expect(persisted.attemptCount).toBe(1);
  });


  it("prevents two concurrent workers from claiming the same invitation", async () => {
    const { delivery } = await createFixture();

    const [first, second] = await Promise.all([
      claimMerchantInvitationDelivery(),
      claimMerchantInvitationDelivery()
    ]);

    const successfulClaims = [first, second].filter(
      (claim) => claim !== null
    );

    expect(successfulClaims).toHaveLength(1);
    expect(successfulClaims[0]?.id).toBe(delivery.id);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("PROCESSING");
    expect(persisted.attemptCount).toBe(1);
    expect(persisted.processingUntil).not.toBeNull();
  });


  it("reclaims an invitation after its processing lease expires", async () => {
    const { delivery } = await createFixture();

    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        status: "PROCESSING",
        attemptCount: 1,
        processingUntil: new Date(
          Date.now() - 60_000
        )
      }
    });

    const reclaimed =
      await claimMerchantInvitationDelivery();

    expect(reclaimed?.id).toBe(delivery.id);
    expect(reclaimed?.status).toBe("PROCESSING");
    expect(reclaimed?.attemptCount).toBe(2);
    expect(
      reclaimed!.processingUntil!.getTime()
    ).toBeGreaterThan(Date.now());
  });


  it("prevents a stale worker from completing a reclaimed invitation", async () => {
    const { delivery } = await createFixture();

    const firstClaim =
      await claimMerchantInvitationDelivery();

    expect(firstClaim?.attemptCount).toBe(1);

    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        processingUntil: new Date(
          Date.now() - 60_000
        )
      }
    });

    const secondClaim =
      await claimMerchantInvitationDelivery();

    expect(secondClaim?.attemptCount).toBe(2);

    const staleCompletion =
      await prisma.merchantInvitationDelivery.updateMany({
        where: {
          id: delivery.id,
          status: "PROCESSING",
          attemptCount: firstClaim!.attemptCount
        },
        data: {
          status: "SENT",
          sentAt: new Date()
        }
      });

    expect(staleCompletion.count).toBe(0);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("PROCESSING");
    expect(persisted.attemptCount).toBe(2);
    expect(persisted.sentAt).toBeNull();
  });


  it("completes a delivery only for its current claim", async () => {
    const { delivery } = await createFixture();

    const firstClaim =
      await claimMerchantInvitationDelivery();

    expect(firstClaim).not.toBeNull();

    const started = await beginMerchantInvitationSending({
      deliveryId: delivery.id,
      attemptCount: firstClaim!.attemptCount
    });

    expect(started).toBe(true);

    const completed =
      await completeMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: firstClaim!.attemptCount,
        providerMessageId: "resend-current-claim"
      });

    expect(completed).toBe(true);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("SENT");
    expect(persisted.providerMessageId).toBe(
      "resend-current-claim"
    );
    expect(persisted.sentAt).toBeInstanceOf(Date);
    expect(persisted.processingUntil).toBeNull();

    // Sensitive invitation material must not remain
    // in the outbox after successful delivery.
    expect(persisted.encryptedToken).toBeNull();

    const duplicateCompletion =
      await completeMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: firstClaim!.attemptCount,
        providerMessageId: "resend-current-claim"
      });

    expect(duplicateCompletion).toBe(false);
  });

  it("does not move a confirmed SENT delivery back to manual review", async () => {
    const { delivery } = await createFixture();

    const claim = await claimMerchantInvitationDelivery();

    expect(claim).not.toBeNull();

    const started = await beginMerchantInvitationSending({
      deliveryId: delivery.id,
      attemptCount: claim!.attemptCount
    });

    expect(started).toBe(true);

    const completed = await completeMerchantInvitationDelivery({
      deliveryId: delivery.id,
      attemptCount: claim!.attemptCount,
      providerMessageId: "resend-confirmed-success"
    });

    expect(completed).toBe(true);

    // Simulate delayed error handling after successful completion.
    const reviewRequired =
      await requireMerchantInvitationDeliveryReview({
        deliveryId: delivery.id,
        attemptCount: claim!.attemptCount
      });

    expect(reviewRequired).toBe(false);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("SENT");
    expect(persisted.providerMessageId).toBe(
      "resend-confirmed-success"
    );
    expect(persisted.sentAt).toBeInstanceOf(Date);
    expect(persisted.processingUntil).toBeNull();
    expect(persisted.encryptedToken).toBeNull();
    expect(persisted.lastError).toBeNull();
    expect(persisted.attemptCount).toBe(1);
  });

  it("does not requeue a delivery after sending has started", async () => {
    const { delivery } = await createFixture();

    const claim = await claimMerchantInvitationDelivery();

    expect(claim).not.toBeNull();

    const started = await beginMerchantInvitationSending({
      deliveryId: delivery.id,
      attemptCount: claim!.attemptCount
    });

    expect(started).toBe(true);

    // A failure handler must not requeue an attempt
    // once the external sending phase has begun.
    const failed = await failMerchantInvitationDelivery({
      deliveryId: delivery.id,
      attemptCount: claim!.attemptCount,
      errorMessage: "Simulated uncertain provider outcome"
    });

    expect(failed).toBe(false);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("SENDING");
    expect(persisted.attemptCount).toBe(1);
    expect(persisted.processingUntil).toBeInstanceOf(Date);
    expect(persisted.sentAt).toBeNull();
    expect(persisted.providerMessageId).toBeNull();
    expect(persisted.encryptedToken).not.toBeNull();

    // No second worker may claim the delivery.
    const nextClaim = await claimMerchantInvitationDelivery();

    expect(nextClaim).toBeNull();

    // The uncertain outcome must enter manual review.
    const reviewRequired =
      await requireMerchantInvitationDeliveryReview({
        deliveryId: delivery.id,
        attemptCount: claim!.attemptCount
      });

    expect(reviewRequired).toBe(true);

    const reviewed =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(reviewed.status).toBe("REVIEW_REQUIRED");
    expect(reviewed.processingUntil).toBeNull();
    expect(reviewed.attemptCount).toBe(1);
    expect(reviewed.encryptedToken).not.toBeNull();

    const claimAfterReview =
      await claimMerchantInvitationDelivery();

    expect(claimAfterReview).toBeNull();
  });


  it("rejects stale completion after another worker reclaims the invitation", async () => {
    const { delivery } = await createFixture();

    const firstClaim =
      await claimMerchantInvitationDelivery();

    expect(firstClaim?.attemptCount).toBe(1);

    // Simulate the first worker losing its lease.
    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        processingUntil: new Date(
          Date.now() - 60_000
        )
      }
    });

    const secondClaim =
      await claimMerchantInvitationDelivery();

    expect(secondClaim?.attemptCount).toBe(2);

    // The first worker must not complete the
    // delivery after losing ownership.
    const staleResult =
      await completeMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: firstClaim!.attemptCount,
        providerMessageId: "resend-stale-attempt"
      });

    expect(staleResult).toBe(false);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("PROCESSING");
    expect(persisted.attemptCount).toBe(2);
    expect(persisted.sentAt).toBeNull();
    expect(persisted.encryptedToken).not.toBeNull();

    // The current worker may complete successfully.
    const started = await beginMerchantInvitationSending({
      deliveryId: delivery.id,
      attemptCount: secondClaim!.attemptCount
    });

    expect(started).toBe(true);
    const currentResult =
      await completeMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: secondClaim!.attemptCount,
        providerMessageId: "resend-current-attempt"
      });

    expect(currentResult).toBe(true);
  });


  it("schedules a retry after a temporary delivery failure", async () => {
    const { delivery } = await createFixture();

    const claim =
      await claimMerchantInvitationDelivery();

    expect(claim?.attemptCount).toBe(1);

    const beforeFailure = new Date();

    const recorded =
      await failMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: claim!.attemptCount,
        errorMessage: "Email provider temporarily unavailable"
      });

    expect(recorded).toBe(true);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("PENDING");
    expect(persisted.attemptCount).toBe(1);
    expect(persisted.processingUntil).toBeNull();
    expect(persisted.nextAttemptAt.getTime()).toBeGreaterThan(
      beforeFailure.getTime()
    );
    expect(persisted.encryptedToken).not.toBeNull();

    // The retry must not be immediately claimable.
    const prematureRetry =
      await claimMerchantInvitationDelivery();

    expect(prematureRetry).toBeNull();
  });


  it("permanently fails delivery after five attempts and clears its token", async () => {
    const { delivery } = await createFixture();

    // Simulate four previous unsuccessful attempts.
    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        status: "PENDING",
        attemptCount: 4
      }
    });

    const claim =
      await claimMerchantInvitationDelivery();

    expect(claim?.attemptCount).toBe(5);

    const recorded =
      await failMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: claim!.attemptCount,
        errorMessage:
          "Provider rejected the fifth delivery attempt"
      });

    expect(recorded).toBe(true);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("FAILED");
    expect(persisted.attemptCount).toBe(5);
    expect(persisted.processingUntil).toBeNull();
    expect(persisted.encryptedToken).toBeNull();
    expect(persisted.sentAt).toBeNull();

    // Exhausted deliveries must not be claimed again.
    const additionalClaim =
      await claimMerchantInvitationDelivery();

    expect(additionalClaim).toBeNull();
  });


  it("never claims a pending invitation that has exhausted its attempt limit", async () => {
    const { delivery } = await createFixture();

    // Simulate an inconsistent database record:
    // the delivery is PENDING despite five attempts.
    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        status: "PENDING",
        attemptCount: 5,
        nextAttemptAt: new Date(
          Date.now() - 60_000
        )
      }
    });

    const claim =
      await claimMerchantInvitationDelivery();

    expect(claim).toBeNull();

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.attemptCount).toBe(5);
    expect(persisted.status).toBe("PENDING");
  });


  it("does not claim an invitation whose activation token has expired", async () => {
    const { activation, delivery } =
      await createFixture();

    // Simulate an activation that expired one minute ago.
    await prisma.merchantOwnerActivation.update({
      where: {
        id: activation.id
      },
      data: {
        expiresAt: new Date(
          Date.now() - 60_000
        )
      }
    });

    const claim =
      await claimMerchantInvitationDelivery();

    expect(claim).toBeNull();

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("PENDING");
    expect(persisted.attemptCount).toBe(0);
    expect(persisted.sentAt).toBeNull();
  });


  it("does not send when a claimed invitation loses its encrypted token", async () => {
    const { delivery } = await createFixture();

    const claimed =
      await claimMerchantInvitationDelivery();

    expect(claimed?.id).toBe(delivery.id);

    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        encryptedToken: null
      }
    });

    const ready =
      await isMerchantInvitationReadyToSend({
        deliveryId: delivery.id,
        attemptCount: claimed!.attemptCount
      });

    expect(ready).toBe(false);

    const cleaned =
      await cleanupExpiredMerchantInvitations();

    expect(cleaned).toBeGreaterThanOrEqual(1);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.sentAt).toBeNull();
    expect(persisted.status).toBe("FAILED");
    expect(persisted.lastError).toBe(
      "Merchant invitation token is invalid"
    );
  });

  it("clears encrypted tokens from expired invitations", async () => {
    const { activation, delivery } =
      await createFixture();

    await prisma.merchantOwnerActivation.update({
      where: {
        id: activation.id
      },
      data: {
        expiresAt: new Date(
          Date.now() - 60_000
        )
      }
    });

    const cleaned =
      await cleanupExpiredMerchantInvitations();

    expect(cleaned).toBeGreaterThanOrEqual(1);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("FAILED");
    expect(persisted.encryptedToken).toBeNull();
    expect(persisted.processingUntil).toBeNull();
    expect(persisted.sentAt).toBeNull();

    // Cleanup must be idempotent.
    const secondCleanup =
      await cleanupExpiredMerchantInvitations();

    expect(secondCleanup).toBe(0);
  });


  it("does not claim an invitation whose activation was consumed", async () => {
    const { activation, delivery } =
      await createFixture();

    await prisma.merchantOwnerActivation.update({
      where: {
        id: activation.id
      },
      data: {
        consumedAt: new Date()
      }
    });

    const claim =
      await claimMerchantInvitationDelivery();

    expect(claim).toBeNull();

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("PENDING");
    expect(persisted.attemptCount).toBe(0);
    expect(persisted.sentAt).toBeNull();

    const cleaned =
      await cleanupExpiredMerchantInvitations();

    expect(cleaned).toBeGreaterThanOrEqual(1);

    const afterCleanup =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(afterCleanup.status).toBe("FAILED");
    expect(afterCleanup.encryptedToken).toBeNull();
  });


  it("rejects sending when activation expires after claiming", async () => {
    const { activation, delivery } =
      await createFixture();

    const claimed =
      await claimMerchantInvitationDelivery();

    expect(claimed?.id).toBe(delivery.id);

    // The invitation expires after the worker claims it.
    await prisma.merchantOwnerActivation.update({
      where: {
        id: activation.id
      },
      data: {
        expiresAt: new Date(Date.now() - 60_000)
      }
    });

    const ready =
      await isMerchantInvitationReadyToSend({
        deliveryId: delivery.id,
        attemptCount: claimed!.attemptCount
      });

    expect(ready).toBe(false);
  });


  it("rejects sending when activation is consumed after claiming", async () => {
    const { activation, delivery } =
      await createFixture();

    const claimed =
      await claimMerchantInvitationDelivery();

    expect(claimed?.id).toBe(delivery.id);

    // Activation is consumed after the worker claims it.
    await prisma.merchantOwnerActivation.update({
      where: {
        id: activation.id
      },
      data: {
        consumedAt: new Date()
      }
    });

    const ready =
      await isMerchantInvitationReadyToSend({
        deliveryId: delivery.id,
        attemptCount: claimed!.attemptCount
      });

    expect(ready).toBe(false);

    const persisted =
      await prisma.merchantInvitationDelivery.findUniqueOrThrow({
        where: {
          id: delivery.id
        }
      });

    expect(persisted.status).toBe("PROCESSING");
    expect(persisted.sentAt).toBeNull();
  });


  it("rejects sending from a stale worker after its lease is reclaimed", async () => {
    const { delivery } =
      await createFixture();

    const firstClaim =
      await claimMerchantInvitationDelivery();

    expect(firstClaim?.id).toBe(delivery.id);

    // Simulate expiration of the first worker's lease.
    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        processingUntil: new Date(
          Date.now() - 60_000
        )
      }
    });

    const secondClaim =
      await claimMerchantInvitationDelivery();

    expect(secondClaim?.id).toBe(delivery.id);
    expect(secondClaim!.attemptCount).toBe(
      firstClaim!.attemptCount + 1
    );

    const staleWorkerReady =
      await isMerchantInvitationReadyToSend({
        deliveryId: delivery.id,
        attemptCount: firstClaim!.attemptCount
      });

    expect(staleWorkerReady).toBe(false);

    const currentWorkerReady =
      await isMerchantInvitationReadyToSend({
        deliveryId: delivery.id,
        attemptCount: secondClaim!.attemptCount
      });

    expect(currentWorkerReady).toBe(true);
  });

  it("sends an activation email and clears the encrypted token", async () => {
    const { delivery } = await createFixture();

    const token = randomUUID();

    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        encryptedToken:
          encryptMerchantInvitation(token)
      }
    });

    const fetchMock = vi.spyOn(
      globalThis,
      "fetch"
    ).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resend-test-message"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    try {
      const processed =
        await processNextMerchantInvitation({
          apiKey: "test-resend-api-key",
          fromEmail: "onboarding@example.test",
          activationBaseUrl:
            "https://merchant.example.test/activate"
        });

      expect(processed).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [requestUrl, requestOptions] =
        fetchMock.mock.calls[0]!;

      expect(requestUrl).toBe(
        "https://api.resend.com/emails"
      );

      const body = JSON.parse(
        String(requestOptions?.body)
      );

      expect(body.to).toEqual([
        delivery.recipientEmail
      ]);

      expect(body.text).toContain(token);

      expect(
        new Headers(requestOptions?.headers).get(
          "Idempotency-Key"
        )
      ).toBe(
        `merchant-invitation/${delivery.id}`
      );

      const persisted =
        await prisma.merchantInvitationDelivery.findUniqueOrThrow({
          where: {
            id: delivery.id
          }
        });

      expect(persisted.status).toBe("SENT");

      expect(persisted.providerMessageId).toBe(
        "resend-test-message"
      );

      expect(persisted.encryptedToken).toBeNull();
      expect(persisted.sentAt).toBeInstanceOf(Date);
      expect(persisted.processingUntil).toBeNull();
      expect(persisted.attemptCount).toBe(1);
    } finally {
      fetchMock.mockRestore();
    }
  });


  it("requires manual review when Resend returns HTTP 429", async () => {
    const { delivery } = await createFixture();

    const token = randomUUID();

    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        encryptedToken:
          encryptMerchantInvitation(token)
      }
    });

    const fetchMock = vi.spyOn(
      globalThis,
      "fetch"
    ).mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Rate limit exceeded"
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );

    try {
      const processed =
        await processNextMerchantInvitation({
          apiKey: "test-resend-api-key",
          fromEmail: "onboarding@example.test",
          activationBaseUrl:
            "https://merchant.example.test/activate"
        });

      expect(processed).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const persisted =
        await prisma.merchantInvitationDelivery.findUniqueOrThrow({
          where: {
            id: delivery.id
          }
        });

      expect(persisted.status).toBe("REVIEW_REQUIRED");
      expect(persisted.attemptCount).toBe(1);
      expect(persisted.processingUntil).toBeNull();
      expect(persisted.sentAt).toBeNull();
      expect(persisted.providerMessageId).toBeNull();

      // Preserve the token until manual investigation.
      expect(persisted.encryptedToken).not.toBeNull();

      // Never expose the provider's untrusted error response.
      expect(persisted.lastError).toBe(
        "Merchant invitation email outcome requires manual review"
      );

      // A delivery requiring review must not be claimed again.
      const nextClaim =
        await claimMerchantInvitationDelivery();

      expect(nextClaim).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });


  it("requires manual review when the Resend network request fails", async () => {
    const { delivery } = await createFixture();

    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        encryptedToken:
          encryptMerchantInvitation(randomUUID())
      }
    });

    const fetchMock = vi.spyOn(
      globalThis,
      "fetch"
    ).mockRejectedValue(
      new Error("Simulated network connection failure")
    );

    try {
      const processed =
        await processNextMerchantInvitation({
          apiKey: "test-resend-api-key",
          fromEmail: "onboarding@example.test",
          activationBaseUrl:
            "https://merchant.example.test/activate"
        });

      expect(processed).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const persisted =
        await prisma.merchantInvitationDelivery.findUniqueOrThrow({
          where: {
            id: delivery.id
          }
        });

      expect(persisted.status).toBe("REVIEW_REQUIRED");
      expect(persisted.attemptCount).toBe(1);
      expect(persisted.processingUntil).toBeNull();
      expect(persisted.sentAt).toBeNull();
      expect(persisted.providerMessageId).toBeNull();

      // Preserve the token for manual investigation.
      expect(persisted.encryptedToken).not.toBeNull();

      // Never expose internal network error details.
      expect(persisted.lastError).toBe(
        "Merchant invitation email outcome requires manual review"
      );

      // The invitation must not be automatically claimed again.
      const nextClaim =
        await claimMerchantInvitationDelivery();

      expect(nextClaim).toBeNull();

      // No second email request should occur.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });


  it("does not send an invitation with a corrupted encrypted token", async () => {
    const { delivery } = await createFixture();

    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        encryptedToken: "corrupted-encrypted-token"
      }
    });

    const fetchMock = vi.spyOn(
      globalThis,
      "fetch"
    );

    try {
      const processed =
        await processNextMerchantInvitation({
          apiKey: "test-resend-api-key",
          fromEmail: "onboarding@example.test",
          activationBaseUrl:
            "https://merchant.example.test/activate"
        });

      expect(processed).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();

      const persisted =
        await prisma.merchantInvitationDelivery.findUniqueOrThrow({
          where: {
            id: delivery.id
          }
        });

      expect(persisted.status).toBe("FAILED");
      expect(persisted.attemptCount).toBe(1);
      expect(persisted.sentAt).toBeNull();

      expect(persisted.lastError).toBe(
        "Merchant invitation token is invalid"
      );
    } finally {
      fetchMock.mockRestore();
    }
  });


  it("permanently fails a corrupted invitation token without retrying", async () => {
    const { delivery } = await createFixture();

    await prisma.merchantInvitationDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        encryptedToken: "corrupted-encrypted-token"
      }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");

    try {
      const processed =
        await processNextMerchantInvitation({
          apiKey: "test-resend-api-key",
          fromEmail: "onboarding@example.test",
          activationBaseUrl:
            "https://merchant.example.test/activate"
        });

      expect(processed).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();

      const persisted =
        await prisma.merchantInvitationDelivery.findUniqueOrThrow({
          where: {
            id: delivery.id
          }
        });

      expect(persisted.status).toBe("FAILED");
      expect(persisted.attemptCount).toBe(1);
      expect(persisted.encryptedToken).toBeNull();
      expect(persisted.processingUntil).toBeNull();
      expect(persisted.sentAt).toBeNull();

      expect(persisted.lastError).toBe(
        "Merchant invitation token is invalid"
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
