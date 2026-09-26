import {
  prisma
} from "@ethio-commerce/database";

import {
  processOverdueMerchantInvoices
} from "../services/invoice-lifecycle.js";

async function main() {
  console.log(
    "PROCESSING OVERDUE MERCHANT INVOICES"
  );

  const result =
    await processOverdueMerchantInvoices();

  console.log(
    `Discovered: ${result.discoveredCount}`
  );

  console.log(
    `Marked overdue: ${result.markedOverdueCount}`
  );

  console.log(
    `Skipped: ${result.skippedCount}`
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