import dotenv from "dotenv";
import path from "node:path";
import { requireTestDatabase } from "./helpers/require-test-database.js";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env"),
  override: false,
});

const suite = process.env.API_TEST_SUITE;

if (
  suite !== "standard" &&
  suite !== "bootstrap-concurrency"
) {
  throw new Error(
    "API_TEST_SUITE must explicitly be standard or bootstrap-concurrency."
  );
}

const expectedDatabase =
  suite === "bootstrap-concurrency"
    ? "ethio_commerce_bootstrap_test"
    : "ethio_commerce_test";

const validatedConnectionString =
  await requireTestDatabase(expectedDatabase);

if (process.env.DATABASE_URL !== validatedConnectionString) {
  throw new Error(
    "DATABASE_URL does not match the validated TEST_DATABASE_URL."
  );
}

if (!process.env.MERCHANT_INVITATION_ENCRYPTION_KEY) {
  process.env.MERCHANT_INVITATION_ENCRYPTION_KEY =
    "test-only-merchant-invitation-encryption-key-2026";
}

if (!process.env.PUBLIC_API_BASE_URL) {
  process.env.PUBLIC_API_BASE_URL =
    "http://127.0.0.1:3000";
}
