import dotenv from "dotenv";
import path from "node:path";

import {
  PLATFORM_BILLING_WORKER_MAX_RUNTIME_MS,
  getPlatformBillingWorkerDeadline,
  canStartPlatformBillingWorkerOperation
} from "../services/platform-billing-worker-runtime.js";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env"),
  override: false,
  quiet: true
});

const MAX_NOTIFICATIONS_PER_RUN = 100;

const STATEMENT_TIMEOUT_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;

let prisma:
  | typeof import("@ethio-commerce/database").prisma
  | undefined;

type WorkerEvent =
  | "worker_started"
  | "worker_scaffold_disabled"
  | "worker_completed"
  | "worker_failed"
  | "worker_disconnected";

function logEvent(
  event: WorkerEvent,
  fields: Record<string, string | number | boolean> = {}
): void {
  console.log(
    JSON.stringify({
      component: "platform_billing_notification_worker",
      event,
      ...fields
    })
  );
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const deadlineAt = getPlatformBillingWorkerDeadline(startedAt);

  logEvent("worker_started", {
    maxNotifications: MAX_NOTIFICATIONS_PER_RUN,
    maxRuntimeMs: PLATFORM_BILLING_WORKER_MAX_RUNTIME_MS,
    statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: LOCK_TIMEOUT_MS
  });

  if (
    !canStartPlatformBillingWorkerOperation(
      deadlineAt,
      Date.now()
    )
  ) {
    throw new Error("WORKER_RUNTIME_BUDGET_EXHAUSTED");
  }

  const database =
    await import("@ethio-commerce/database");

  prisma = database.prisma;

  if (
    !canStartPlatformBillingWorkerOperation(
      deadlineAt,
      Date.now()
    )
  ) {
    throw new Error("WORKER_RUNTIME_BUDGET_EXHAUSTED");
  }

  // B6.6 remains non-sending.
  // Database timeout enforcement and operational processing
  // must be verified before enabling claim or send operations.
  logEvent("worker_scaffold_disabled", {
    sendingEnabled: false,
    processingEnabled: false
  });

  const completedAt = Date.now();

  if (completedAt >= deadlineAt) {
    throw new Error("WORKER_RUNTIME_BUDGET_EXHAUSTED");
  }

  logEvent("worker_completed", {
    durationMs: completedAt - startedAt,
    deadlineExceeded: false,
    processedCount: 0
  });
}

main()
  .catch(() => {
    // Do not emit raw exceptions, SQL, credentials,
    // Telegram identifiers, or environment values.
    logEvent("worker_failed", {
      errorCode: "WORKER_EXECUTION_FAILED"
    });

    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma?.$disconnect();
      logEvent("worker_disconnected");
    } catch {
      logEvent("worker_failed", {
        errorCode: "DATABASE_DISCONNECT_FAILED"
      });

      process.exitCode = 1;
    }
  });