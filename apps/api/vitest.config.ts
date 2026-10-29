import { defineConfig } from "vitest/config";

const suite = process.env.API_TEST_SUITE;

const bootstrapTest = "**/platform-bootstrap.test.ts";
const concurrencyTest =
  "**/platform-bootstrap-concurrency.test.ts";

const explicitlySelectedBootstrapTest =
  process.argv.some((arg) =>
    arg.endsWith("platform-bootstrap.test.ts")
  );

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.mts"],

    ...(suite === "bootstrap-concurrency"
      ? {
          include: [concurrencyTest]
        }
      : {}),

    exclude: [
      "dist/**",
      "node_modules/**",
      ...(suite === "bootstrap-concurrency"
        ? [bootstrapTest]
        : [
            concurrencyTest,
            ...(explicitlySelectedBootstrapTest
              ? []
              : [bootstrapTest])
          ])
    ],

    fileParallelism: false
  }
});
