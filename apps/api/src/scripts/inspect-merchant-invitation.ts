import { prisma } from "@ethio-commerce/database";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  override: false
});

const MAX_DELIVERY_ATTEMPTS = 5;

function requiredArgument(
  name: string,
  value: string | undefined
): string {
  if (!value?.trim()) {
    throw new Error(
      `Missing required argument: ${name}`
    );
  }

  return value.trim();
}

async function main() {
  const args = process.argv.slice(2);

  if (
    args.length !== 3 ||
    args.some((arg) => arg.startsWith("--"))
  ) {
    throw new Error(
      "Usage: inspect-merchant-invitation <deliveryId> <merchantId> <recipientEmail>"
    );
  }

  const deliveryId = requiredArgument(
    "deliveryId",
    args[0]
  );

  const merchantId = requiredArgument(
    "merchantId",
    args[1]
  );

  const recipientEmail = requiredArgument(
    "recipientEmail",
    args[2]
  );

  const delivery =
    await prisma.merchantInvitationDelivery.findUnique({
      where: {
        id: deliveryId
      },
      select: {
        id: true,
        status: true,
        recipientEmail: true,
        attemptCount: true,
        nextAttemptAt: true,
        processingUntil: true,
        encryptedToken: true,
        activation: {
          select: {
            merchantId: true,
            ownerEmail: true,
            expiresAt: true,
            consumedAt: true
          }
        }
      }
    });

  if (
    !delivery ||
    delivery.activation.merchantId !== merchantId ||
    delivery.recipientEmail !== recipientEmail ||
    delivery.activation.ownerEmail !== recipientEmail
  ) {
    console.log(
      "DRY RUN: No invitation matches all supplied identities."
    );
    process.exitCode = 1;
    return;
  }

  const now = new Date();

  const duePending =
    delivery.status === "PENDING" &&
    delivery.nextAttemptAt <= now;

  const expiredProcessingLease =
    delivery.status === "PROCESSING" &&
    delivery.processingUntil !== null &&
    delivery.processingUntil <= now;

  const eligible =
    (duePending || expiredProcessingLease) &&
    delivery.activation.expiresAt > now &&
    delivery.activation.consumedAt === null &&
    delivery.attemptCount < MAX_DELIVERY_ATTEMPTS &&
    delivery.encryptedToken !== null;

  console.log("DRY RUN: Merchant invitation inspection");
  console.log("Delivery ID:", delivery.id);
  console.log("Merchant ID:", delivery.activation.merchantId);
  console.log("Recipient email:", delivery.recipientEmail);
  console.log("Status:", delivery.status);
  console.log("Attempt count:", delivery.attemptCount);
  console.log("Eligible for targeted processing:", eligible);
  console.log("No invitation was claimed or sent.");
}

main()
  .catch((error) => {
    console.error(
      "Merchant invitation inspection failed:",
      error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
