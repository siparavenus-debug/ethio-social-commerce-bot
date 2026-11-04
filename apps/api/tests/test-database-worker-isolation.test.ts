import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("test worker database isolation", () => {
  it("rejects DATABASE_URL mismatches before test execution", () => {
    const validatedTestUrl = process.env.TEST_DATABASE_URL;

    expect(validatedTestUrl).toBeTruthy();

    const script = `
      import("./tests/setup.mts")
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
      API_TEST_SUITE: "standard",
      TEST_DATABASE_URL: validatedTestUrl,
      DATABASE_URL:
        "postgresql://test:test@127.0.0.1:1/ethio_commerce"
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
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      "DATABASE_URL does not match the validated TEST_DATABASE_URL."
    );
    expect(result.stdout).not.toContain("UNEXPECTED_SUCCESS");
  });
});
