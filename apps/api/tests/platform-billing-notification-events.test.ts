import { randomUUID } from "node:crypto";

import {
  PlatformBillingEventType,
  prisma
} from "@ethio-commerce/database";

import {
  describe,
  expect,
  it
} from "vitest";

import {
  createPlatformBillingEvent
} from "../src/services/platform-billing-notification-events.js";

const ROLLBACK = "UNIT_2B_EXPECTED_ROLLBACK";

async function withRollback(
  callback: (
    tx: Parameters<
      Parameters<typeof prisma.$transaction>[0]
    >[0]
  ) => Promise<void>
) {
  try {
    await prisma.$transaction(async (tx) => {
      await callback(tx);
      throw new Error(ROLLBACK);
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== ROLLBACK
    ) {
      throw error;
    }
  }
}

describe("B3.6 Unit 2B billing event foundation", () => {
  it("creates a durable event without materializing a notification", async () => {
    await withRollback(async (tx) => {
      const merchant = await tx.merchant.create({
        data: {
          name: `Unit 2B ${randomUUID()}`,
        }
      });

      const event = await createPlatformBillingEvent(
        tx,
        {
          merchantId: merchant.id,
          type: PlatformBillingEventType.INVOICE_ISSUED,
          sourceId: randomUUID(),
          occurrenceKey: `UNIT2B:${randomUUID()}`
        }
      );

      expect(event.merchantId).toBe(merchant.id);
      expect(event.type).toBe(PlatformBillingEventType.INVOICE_ISSUED);
      expect(event.sourceId).toBeTruthy();
      expect(event.occurrenceKey).toMatch(/^UNIT2B:/);

      const persisted = await tx.platformBillingEvent.findUnique({
        where: { id: event.id },
        include: { notification: true }
      });

      expect(persisted).not.toBeNull();
      expect(persisted?.notification).toBeNull();
    });
  });

  it("verifies a previously committed durable event without creating a notification", async () => {
    // Append-only fixture created by the original committed-persistence test.
    // This verifies persisted state without attempting to delete audit events.
    const sourceId = "fbde3439-3835-494c-ace9-cecb639e9b8c";
    const merchantId = "872d5530-d0c8-4a46-926f-f74e5293d101";
    const occurrenceKey = `UNIT2B:COMMITTED:${sourceId}`;

    const persisted = await prisma.platformBillingEvent.findUnique({
      where: { occurrenceKey },
      include: { notification: true }
    });

    expect(persisted).not.toBeNull();
    expect(persisted?.merchantId).toBe(merchantId);
    expect(persisted?.type).toBe(
      PlatformBillingEventType.INVOICE_ISSUED
    );
    expect(persisted?.sourceId).toBe(sourceId);
    expect(persisted?.occurrenceKey).toBe(occurrenceKey);
    expect(persisted?.notification).toBeNull();
  });
  it("rolls back durable event creation", async () => {
    const occurrenceKey = `UNIT2B:${randomUUID()}`;

    await withRollback(async (tx) => {
      const merchant = await tx.merchant.create({
        data: {
          name: `Unit 2B ${randomUUID()}`,
        }
      });

      await createPlatformBillingEvent(tx, {
        merchantId: merchant.id,
        type: PlatformBillingEventType.INVOICE_ISSUED,
        sourceId: randomUUID(),
        occurrenceKey
      });
    });

    const persisted =
      await prisma.platformBillingEvent.findUnique({
        where: { occurrenceKey }
      });

    expect(persisted).toBeNull();
  });

  it("rejects duplicate occurrence keys", async () => {
    await withRollback(async (tx) => {
      const merchant = await tx.merchant.create({
        data: {
          name: `Unit 2B ${randomUUID()}`,
        }
      });

      const input = {
        merchantId: merchant.id,
        type: PlatformBillingEventType.INVOICE_ISSUED,
        sourceId: randomUUID(),
        occurrenceKey: `UNIT2B:${randomUUID()}`
      };

      await createPlatformBillingEvent(tx, input);

      await expect(
        createPlatformBillingEvent(tx, input)
      ).rejects.toMatchObject({
        code: "P2002"
      });
    });
  });

  it("rejects conflicting identities using the same occurrence key", async () => {
    await withRollback(async (tx) => {
      const merchant = await tx.merchant.create({
        data: {
          name: `Unit 2B ${randomUUID()}`,
        }
      });

      const occurrenceKey = `UNIT2B:${randomUUID()}`;

      await createPlatformBillingEvent(tx, {
        merchantId: merchant.id,
        type: PlatformBillingEventType.INVOICE_ISSUED,
        sourceId: randomUUID(),
        occurrenceKey
      });

      await expect(
        createPlatformBillingEvent(tx, {
          merchantId: merchant.id,
          type: PlatformBillingEventType.INVOICE_PAID,
          sourceId: randomUUID(),
          occurrenceKey
        })
      ).rejects.toMatchObject({
        code: "P2002"
      });
    });
  });
});
