import { Client } from "pg";

const ALLOWED_TEST_DATABASES = [
  "ethio_commerce_test",
  "ethio_commerce_bootstrap_test"
] as const;

export type TestDatabaseName =
  (typeof ALLOWED_TEST_DATABASES)[number];

export async function requireTestDatabase(
  expectedDatabase: TestDatabaseName
): Promise<string> {
  const connectionString = process.env.TEST_DATABASE_URL;

  if (!connectionString?.trim()) {
    throw new Error(
      "TEST_DATABASE_URL must be explicitly configured before running API tests."
    );
  }

  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }

  if (
    url.protocol !== "postgresql:" &&
    url.protocol !== "postgres:"
  ) {
    throw new Error(
      "TEST_DATABASE_URL must use a PostgreSQL connection string."
    );
  }

  const configuredDatabase =
    decodeURIComponent(url.pathname.slice(1));

  if (
    configuredDatabase !== expectedDatabase ||
    !ALLOWED_TEST_DATABASES.includes(
      configuredDatabase as TestDatabaseName
    )
  ) {
    throw new Error(
      `API tests require database ${expectedDatabase}. Configured database is not authorized.`
    );
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();

    const result = await client.query<{
      database_name: string;
    }>(
      "SELECT current_database() AS database_name"
    );

    if (result.rows[0]?.database_name !== expectedDatabase) {
      throw new Error(
        `Connected database does not match required test database ${expectedDatabase}.`
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  return connectionString;
}
