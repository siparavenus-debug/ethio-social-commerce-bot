import {
  prisma
} from "@ethio-commerce/database";

import {
  processOverdueMerchantInvoices,
  processPastDueSubscriptionSuspensions,
  processSecondOverdueInvoiceReminders
} from "../services/invoice-lifecycle.js";

async function main() {
  console.log(
    "PROCESSING OVERDUE MERCHANT INVOICES"
  );

  const now =
    new Date();

  const overdueResult =
    await processOverdueMerchantInvoices({
      now
    });

  console.log(
    `Overdue discovered: ${overdueResult.discoveredCount}`
  );

  console.log(
    `Marked overdue: ${overdueResult.markedOverdueCount}`
  );

  console.log(
    `Overdue skipped: ${overdueResult.skippedCount}`
  );

  const reminderResult =
    await processSecondOverdueInvoiceReminders({
      now
    });

  console.log(
    `Second reminders discovered: ${reminderResult.discoveredCount}`
  );

  console.log(
    `Second reminders created: ${reminderResult.createdCount}`
  );

  console.log(
    `Second reminders skipped: ${reminderResult.skippedCount}`
  );

  const suspensionResult =
    await processPastDueSubscriptionSuspensions({
      now
    });

  console.log(
    `Suspensions discovered: ${suspensionResult.discoveredCount}`
  );

  console.log(
    `Subscriptions suspended: ${suspensionResult.suspendedCount}`
  );

  console.log(
    `Suspensions skipped: ${suspensionResult.skippedCount}`
  );
}

main()
  .catch((error) => {
    console.error(
      "Overdue invoice processing failed:",
      error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });