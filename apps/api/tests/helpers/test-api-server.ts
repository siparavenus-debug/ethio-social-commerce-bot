import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { requireTestDatabase } from "./require-test-database.js";

export const TEST_API_PORT = 3100;
export const TEST_API_BASE_URL =
  `http://127.0.0.1:${TEST_API_PORT}`;

let testApiProcess: ChildProcess | undefined;

async function isPortOccupied(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({
      host: "127.0.0.1",
      port: TEST_API_PORT
    });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(true);
    });
  });
}

export async function startTestApiServer(): Promise<void> {
  if (process.env.API_TEST_SUITE !== "standard") {
    throw new Error(
      "The dedicated test API requires API_TEST_SUITE=standard."
    );
  }

  if (testApiProcess) {
    throw new Error("The test API server is already running.");
  }

  const databaseUrl =
    await requireTestDatabase("ethio_commerce_test");

  const instanceToken = randomUUID();

  if (await isPortOccupied()) {
    throw new Error(
      `Port ${TEST_API_PORT} is already occupied. Refusing to use an existing server.`
    );
  }

  const apiDirectory = path.resolve(
    process.cwd()
  );

  const entryPoint = path.join(
    apiDirectory,
    "dist",
    "index.js"
  );

  if (!existsSync(entryPoint)) {
    throw new Error(
      `Compiled test API not found at ${entryPoint}. Build apps/api before running integration tests.`
    );
  }

  const child = spawn(
    process.execPath,
    [entryPoint],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        NODE_ENV: "test",
        API_TEST_SUITE: "standard",
        TEST_DATABASE_URL: databaseUrl,
        DATABASE_URL: databaseUrl,
        PORT: String(TEST_API_PORT),
        API_PORT: String(TEST_API_PORT),
        TEST_API_INSTANCE_TOKEN: instanceToken
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );

  testApiProcess = child;

  let output = "";
  let startupError: Error | undefined;

  const appendOutput = (chunk: Buffer): void => {
    output = (output + chunk.toString()).slice(-65536);
  };

  child.on("error", (error: Error) => {
    startupError = error;
  });

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (startupError) {
        throw new Error(
          `Test API failed to start: ${startupError.message}`
        );
      }

      if (
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        throw new Error(
          `Test API exited unexpectedly. ${output}`
        );
      }

      try {
        const response = await fetch(
          `${TEST_API_BASE_URL}/health`,
          {
            signal: AbortSignal.timeout(1000)
          }
        );

        if (
          response.ok &&
          response.headers.get("X-Test-API-Instance") ===
            instanceToken
        ) {
          return;
        }
      } catch {
        // The API may still be starting.
      }

      await delay(200);
    }

    throw new Error(
      `Test API did not become ready. ${output}`
    );
  } catch (error) {
    try {
      await stopTestApiServer();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Test API startup failed and cleanup also failed."
      );
    }

    throw error;
  }
}

export async function stopTestApiServer(): Promise<void> {
  const child = testApiProcess;

  if (!child) {
    return;
  }

  if (
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    testApiProcess = undefined;
    return;
  }

  const exited = new Promise<boolean>((resolve) => {
    child.once("exit", () => resolve(true));
  });

  if (
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    testApiProcess = undefined;
    return;
  }

  const terminationRequested = child.kill();

  if (!terminationRequested) {
    if (
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      testApiProcess = undefined;
      return;
    }

    throw new Error(
      `Unable to terminate test API process ${child.pid ?? "unknown"}.`
    );
  }

  const didExit = await Promise.race([
    exited,
    delay(5000).then(() => false)
  ]);

  if (
    !didExit &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    throw new Error(
      `Test API process ${child.pid ?? "unknown"} did not exit within 5 seconds.`
    );
  }

  testApiProcess = undefined;
}
