import {
  requireTestDatabase,
  type TestDatabaseName
} from "./helpers/require-test-database.js";

export async function setup(): Promise<void> {
  const suite = process.env.API_TEST_SUITE;

  let expectedDatabase: TestDatabaseName;

  if (suite === "standard") {
    expectedDatabase = "ethio_commerce_test";
  } else if (suite === "bootstrap-concurrency") {
    expectedDatabase = "ethio_commerce_bootstrap_test";
  } else {
    throw new Error(
      "API_TEST_SUITE must explicitly be standard or bootstrap-concurrency."
    );
  }

  const validatedConnectionString =
    await requireTestDatabase(expectedDatabase);

  process.env.DATABASE_URL = validatedConnectionString;
}
