
import {
    prisma
  } from "@ethio-commerce/database";

  export async function requireBootstrapTestDatabase(
    expectedDatabase = "ethio_commerce_test"
  ) {
    const allowedDatabases = [
      "ethio_commerce_test",
      "ethio_commerce_bootstrap_test"
    ];

    if (!allowedDatabases.includes(expectedDatabase)) {
      throw new Error(
        "Unauthorized bootstrap test database."
      );
    }

    const result = await prisma.$queryRaw<
      Array<{ database_name: string }>
    >`
      SELECT current_database() AS database_name
    `;

    const actualDatabase =
      result[0]?.database_name;

    if (actualDatabase !== expectedDatabase) {
      throw new Error(
        `Bootstrap tests require ${expectedDatabase}. Connected to: ${actualDatabase ?? "unknown"}`
      );
    }
  }
