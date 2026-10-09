
import { defineConfig } from "vitest/config";

const isolatedBootstrapTests = [
  "**/platform-bootstrap.test.ts",
  "**/platform-bootstrap-concurrency.test.ts"
];

const explicitlySelectedBootstrapTest =
  process.argv.some((arg) =>
    isolatedBootstrapTests.some((pattern) =>
      arg.endsWith(pattern.replace("**/", ""))
    )
  );

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    exclude: [
      "dist/**",
      "node_modules/**",
      ...(
        explicitlySelectedBootstrapTest
          ? []
          : isolatedBootstrapTests
      )
    ],
    fileParallelism: false
  }
});
