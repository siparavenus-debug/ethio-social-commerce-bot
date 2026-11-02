import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = path.resolve(
  process.cwd(),
  "dist/scripts/process-specific-merchant-invitation.js"
);

const validArgs = [
  "test-delivery-id",
  "test-merchant-id",
  "owner@example.test"
];

function runCli(
  args: string[],
  options: {
    nodeEnv?: string;
    executionMode?: string;
  } = {}
) {
  const env: NodeJS.ProcessEnv = {
    ...process.env
  };

  delete env.NODE_ENV;
  delete env.MERCHANT_INVITATION_EXECUTION_MODE;
  delete env.DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  delete env.RESEND_API_KEY;

  if (options.nodeEnv !== undefined) {
    env.NODE_ENV = options.nodeEnv;
  }

  if (options.executionMode !== undefined) {
    env.MERCHANT_INVITATION_EXECUTION_MODE =
      options.executionMode;
  }

  return spawnSync(
    process.execPath,
    [script, ...args],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      timeout: 10000
    }
  );
}

describe("targeted merchant invitation validation CLI", () => {
  it("rejects missing arguments", () => {
    const result = runCli([]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it("rejects unexpected additional arguments", () => {
    const result = runCli([
      ...validArgs,
      "unexpected"
    ]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it("rejects option-style arguments", () => {
    const result = runCli([
      "--delivery",
      validArgs[1]!,
      validArgs[2]!
    ]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it("rejects execution outside the test environment", () => {
    const result = runCli(validArgs, {
      nodeEnv: "production",
      executionMode: "validate-only"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "disabled outside the test environment"
    );
  });

  it("rejects execution without validate-only mode", () => {
    const result = runCli(validArgs, {
      nodeEnv: "test"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "must be validate-only"
    );
  });

  it("rejects an explicit send execution mode", () => {
    const result = runCli(validArgs, {
      nodeEnv: "test",
      executionMode: "send"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "MERCHANT_INVITATION_EXECUTION_MODE must be validate-only."
    );
    expect(result.stdout).not.toContain(
      "VALIDATION ONLY: Targeted merchant invitation"
    );
  });
  it("accepts validation-only mode without database or email credentials", () => {
    const result = runCli(validArgs, {
      nodeEnv: "test",
      executionMode: "validate-only"
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);

    expect(result.stdout).toContain(
      "VALIDATION ONLY: Targeted merchant invitation"
    );

    expect(result.stdout).toContain(
      "No database connection was opened."
    );

    expect(result.stdout).toContain(
      "No invitation was claimed or sent."
    );

    expect(result.stdout).toContain(
      "Delivery ID: test-delivery-id"
    );
  });
});
