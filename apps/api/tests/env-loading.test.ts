import { afterEach, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

  it("initializes Prisma after loading DATABASE_URL from .env", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "ethio-prisma-env-test-")
    );

    try {
      writeFileSync(
        path.join(directory, ".env"),
        "DATABASE_URL=postgresql://test:test@127.0.0.1:1/ethio_commerce_test\n"
      );

      const databaseModuleUrl = import.meta.resolve("@ethio-commerce/database");
      const dotenvModuleUrl = import.meta.resolve("dotenv");

      const script = `
        import dotenv from ${JSON.stringify(dotenvModuleUrl)};

        dotenv.config({
          path: ".env",
          override: false
        });

        import(${JSON.stringify(databaseModuleUrl)})
          .then(() => process.stdout.write("PRISMA_ENV_OK"))
          .catch((error) => {
            process.stderr.write(String(error.message));
            process.exitCode = 1;
          });
      `;

      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        Path: process.env.Path,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NODE_ENV: "test"
      };

      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          script
        ],
        {
          cwd: directory,
          env,
          encoding: "utf8",
          timeout: 10000
        }
      );

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("PRISMA_ENV_OK");
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  });
  it("loads invitation worker encryption without unrelated API secrets", () => {
    const script = `
      import("./src/services/merchant-invitation-encryption.ts")
        .then(() => process.stdout.write("WORKER_CONFIG_OK"))
        .catch((error) => {
          process.stderr.write(String(error.message));
          process.exitCode = 1;
        });
    `;

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "test",
      MERCHANT_INVITATION_ENCRYPTION_KEY:
        "test-only-merchant-invitation-encryption-key-2026"
    };

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
        timeout: 10000
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("WORKER_CONFIG_OK");
  });

  it("rejects an invitation encryption key reused as AUTH_SECRET", () => {
    const sharedSecret =
      "test-only-shared-security-secret-2026";

    const script = `
      import("./src/config/env.ts")
        .then(() => process.stdout.write("UNEXPECTED_SUCCESS"))
        .catch((error) => {
          process.stderr.write(String(error.message));
          process.exitCode = 1;
        });
    `;

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "test",
      AUTH_SECRET: sharedSecret,
      PLATFORM_AUTH_SECRET:
        "test-only-platform-auth-secret-2026",
      DELIVERY_CONFIRMATION_SECRET:
        "test-only-delivery-confirmation-secret-2026",
      TELEGRAM_CREDENTIAL_ENCRYPTION_KEY:
        "test-only-telegram-encryption-key-2026",
      MERCHANT_INVITATION_ENCRYPTION_KEY:
        sharedSecret
    };

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
        timeout: 10000
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "MERCHANT_INVITATION_ENCRYPTION_KEY must differ from existing security secrets."
    );
    expect(result.stdout).not.toContain(
      "UNEXPECTED_SUCCESS"
    );
  });
});
