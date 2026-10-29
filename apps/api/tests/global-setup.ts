import dotenv from "dotenv";
import path from "node:path";

import {
  requireTestDatabase,
  type TestDatabaseName
} from "./helpers/require-test-database.js";
import {
  startTestApiServer,
  stopTestApiServer
} from "./helpers/test-api-server.js";

export async function setup(): Promise<void> {
  dotenv.config({
    path: path.resolve(process.cwd(), "../../.env"),
    override: false
  });

  if (!process.env.MERCHANT_INVITATION_ENCRYPTION_KEY) {
    process.env.MERCHANT_INVITATION_ENCRYPTION_KEY =
      "test-only-merchant-invitation-encryption-key-2026";
  }

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

  if (suite === "standard") {
    await startTestApiServer();
  }
}

export async function teardown(): Promise<void> {
  if (process.env.API_TEST_SUITE === "standard") {
    await stopTestApiServer();
  }
}
