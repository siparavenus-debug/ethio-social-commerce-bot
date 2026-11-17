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

async function runRecovery(): Promise<{
  recoveredCount: number;
  reviewRequiredCount: number;
  failedCount: number;
  requeuedCount: number;
}> {
  const {
    recoverExpiredPlatformBillingNotificationDeliveries
  } = await import(
    "../services/platform-billing-notification-recovery.js"
  );

  const results =
    await recoverExpiredPlatformBillingNotificationDeliveries(
      undefined,
      {
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
        lockTimeoutMs: LOCK_TIMEOUT_MS
      }
    );

  return {
    recoveredCount: results.filter(
      (result) => result.recovered
    ).length,
    reviewRequiredCount: results.filter(
      (result) =>
        result.recovered &&
        result.action === "REVIEW_REQUIRED"
    ).length,
    failedCount: results.filter(
      (result) =>
        result.recovered &&
        result.action === "FAILED"
    ).length,
    requeuedCount: results.filter(
      (result) =>
        result.recovered &&
        result.action === "REQUEUED"
    ).length
  };
}

async function requireIsolatedRecoveryDatabase(): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;

  if (!connectionString?.trim()) {
    throw new Error("RECOVERY_TEST_DATABASE_NOT_CONFIGURED");
  }

  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("RECOVERY_TEST_DATABASE_URL_INVALID");
  }

  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname.slice(1)) !==
      "ethio_commerce_b53_concurrency_test"
  ) {
    throw new Error("RECOVERY_TEST_DATABASE_NOT_AUTHORIZED");
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString });

  try {
    await client.connect();

    const result = await client.query<{
      database_name: string;
    }>("SELECT current_database() AS database_name");

    if (
      result.rows[0]?.database_name !==
      "ethio_commerce_b53_concurrency_test"
    ) {
      throw new Error("RECOVERY_TEST_DATABASE_IDENTITY_MISMATCH");
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  process.env.DATABASE_URL = connectionString;
}

type ClaimProcessingResult =
  | {
      status: "DISPOSITION_APPLIED";
      disposition: "SUPPRESS" | "DEFER" | "REVIEW_REQUIRED";
    }
  | {
      status: "AWAITING_ATTEMPT_FENCE";
    }
  | {
      status: "CLAIM_REJECTED";
      reason: string;
    };

async function processClaimedDelivery(
  deliveryId: string,
  claimId: string
): Promise<ClaimProcessingResult> {
  const {
    applyPlatformBillingPreSendDecision
  } = await import(
    "../services/platform-billing-notification-decision.js"
  );

  const decision = await applyPlatformBillingPreSendDecision(
    deliveryId,
    claimId
  );

  if (decision.applied) {
    return {
      status: "DISPOSITION_APPLIED",
      disposition: decision.disposition
    };
  }

  if (decision.reason === "ELIGIBLE_AWAITING_ATTEMPT_FENCE") {
    return {
      status: "AWAITING_ATTEMPT_FENCE"
    };
  }

  return {
    status: "CLAIM_REJECTED",
    reason: decision.reason
  };
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

  const recoveryEnabled =
  process.env.API_TEST_SUITE === "billing-b53-concurrency" &&
  process.env.PLATFORM_BILLING_TEST_RECOVERY === "enabled";

  if (recoveryEnabled) {
    await requireIsolatedRecoveryDatabase();
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

// Recovery can be enabled only for the approved isolated
// concurrency-test suite. Never enable through a generic
// production environment variable.


if (recoveryEnabled) {
  if (
    !canStartPlatformBillingWorkerOperation(
      deadlineAt,
      Date.now(),
      STATEMENT_TIMEOUT_MS + LOCK_TIMEOUT_MS
    )
  ) {
    throw new Error("WORKER_RUNTIME_BUDGET_EXHAUSTED");
  }

  const recovery = await runRecovery();

  logEvent("worker_completed", {
    recoveredCount: recovery.recoveredCount,
    reviewRequiredCount: recovery.reviewRequiredCount,
    failedCount: recovery.failedCount,
    requeuedCount: recovery.requeuedCount
  });
}

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