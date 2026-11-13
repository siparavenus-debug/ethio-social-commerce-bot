import { materializePlatformBillingNotification } from "./platform-billing-notification-materializer.js";
import {
  Prisma,
  PlatformBillingEventType
} from "@ethio-commerce/database";

export type CreatePlatformBillingEventInput = {
  merchantId: string;
  type: PlatformBillingEventType;
  sourceId: string;
  occurrenceKey: string;
};

/**
 * Creates one durable billing event within an existing
 * business transaction.
 *
 * This function does not start its own transaction and
 * does not perform external network requests.
 *
 * Occurrence-key uniqueness is enforced by PostgreSQL.
 * Duplicate-key errors propagate to the caller.
 */
export async function createPlatformBillingEvent(
  tx: Prisma.TransactionClient,
  input: CreatePlatformBillingEventInput
) {
  const merchantId = input.merchantId.trim();
  const sourceId = input.sourceId.trim();
  const occurrenceKey = input.occurrenceKey.trim();

  if (
    !merchantId ||
    !sourceId ||
    !occurrenceKey
  ) {
    throw new Error(
      "Billing event identity fields are required"
    );
  }

  const event = await tx.platformBillingEvent.create({
    data: {
      merchantId,
      type: input.type,
      sourceId,
      occurrenceKey
    }
  });

  await materializePlatformBillingNotification(
    tx,
    event
  );

  return event;
}
