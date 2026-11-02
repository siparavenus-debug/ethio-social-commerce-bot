const USAGE =
  "Usage: process-specific-merchant-invitation <deliveryId> <merchantId> <recipientEmail>";

function requiredArgument(
  name: string,
  value: string | undefined
): string {
  if (!value?.trim()) {
    throw new Error(`Missing required argument: ${name}`);
  }

  return value.trim();
}

function main(): void {
  const args = process.argv.slice(2);

  if (
    args.length !== 3 ||
    args.some((arg) => arg.startsWith("--"))
  ) {
    throw new Error(USAGE);
  }

  const deliveryId = requiredArgument("deliveryId", args[0]);
  const merchantId = requiredArgument("merchantId", args[1]);
  const recipientEmail = requiredArgument("recipientEmail", args[2]);

  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Targeted invitation execution is disabled outside the test environment."
    );
  }

  if (
    process.env.MERCHANT_INVITATION_EXECUTION_MODE !==
    "validate-only"
  ) {
    throw new Error(
      "MERCHANT_INVITATION_EXECUTION_MODE must be validate-only."
    );
  }

  console.log("VALIDATION ONLY: Targeted merchant invitation");
  console.log("Delivery ID:", deliveryId);
  console.log("Merchant ID:", merchantId);
  console.log("Recipient email:", recipientEmail);
  console.log("No database connection was opened.");
  console.log("No invitation was claimed or sent.");
}

try {
  main();
} catch (error) {
  console.error(
    "Targeted invitation validation failed:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
}
