import { afterEach, describe, expect, it } from "vitest";

import { requireTestDatabase } from "./helpers/require-test-database.js";

const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;

afterEach(() => {
  if (originalTestDatabaseUrl === undefined) {
    delete process.env.TEST_DATABASE_URL;
  } else {
    process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
  }
});

describe("test database guard", () => {
  it("rejects missing TEST_DATABASE_URL", async () => {
    delete process.env.TEST_DATABASE_URL;

    await expect(
      requireTestDatabase("ethio_commerce_test")
    ).rejects.toThrow(
      "TEST_DATABASE_URL must be explicitly configured"
    );
  });

  it("rejects malformed connection strings", async () => {
    process.env.TEST_DATABASE_URL = "not-a-url";

    await expect(
      requireTestDatabase("ethio_commerce_test")
    ).rejects.toThrow(
      "TEST_DATABASE_URL is not a valid URL."
    );
  });

  it("rejects non-PostgreSQL protocols", async () => {
    process.env.TEST_DATABASE_URL =
      "mysql://test:test@127.0.0.1:1/ethio_commerce_test";

    await expect(
      requireTestDatabase("ethio_commerce_test")
    ).rejects.toThrow(
      "TEST_DATABASE_URL must use a PostgreSQL connection string."
    );
  });

  it("rejects the development database", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://test:test@127.0.0.1:1/ethio_commerce";

    await expect(
      requireTestDatabase("ethio_commerce_test")
    ).rejects.toThrow(
      "Configured database is not authorized."
    );
  });

  it("rejects the bootstrap database for the standard suite", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://test:test@127.0.0.1:1/ethio_commerce_bootstrap_test";

    await expect(
      requireTestDatabase("ethio_commerce_test")
    ).rejects.toThrow(
      "Configured database is not authorized."
    );
  });

  it("rejects the standard database for the bootstrap suite", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://test:test@127.0.0.1:1/ethio_commerce_test";

    await expect(
      requireTestDatabase("ethio_commerce_bootstrap_test")
    ).rejects.toThrow(
      "Configured database is not authorized."
    );
  });
});
