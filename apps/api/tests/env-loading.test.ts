import { afterEach, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("environment loading", () => {
  const originalValue = process.env.ENV_PRECEDENCE_TEST;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ENV_PRECEDENCE_TEST;
    } else {
      process.env.ENV_PRECEDENCE_TEST = originalValue;
    }
  });

  it("preserves existing environment variables over .env values", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "ethio-env-test-")
    );

    const envFile = path.join(directory, ".env");

    try {
      writeFileSync(
        envFile,
        "ENV_PRECEDENCE_TEST=local-file-value\n"
      );

      process.env.ENV_PRECEDENCE_TEST =
        "railway-environment-value";

      dotenv.config({
        path: envFile,
        override: false
      });

      expect(
        process.env.ENV_PRECEDENCE_TEST
      ).toBe("railway-environment-value");
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  });
});