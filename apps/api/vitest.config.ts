import { defineConfig } from "vitest/config";

const suite = process.env.API_TEST_SUITE;

const billingTelegramB3Tests = [
  "**/merchant-billing-telegram-route.test.ts",
  "**/merchant-billing-telegram-db.test.ts",
  "**/merchant-billing-telegram-link-token.test.ts",
  "**/merchant-billing-telegram-redemption-db.test.ts",
  "**/merchant-billing-telegram-preferences-db.test.ts",
  "**/platform-billing-telegram-webhook.test.ts",
  "**/platform-billing-notification-events.test.ts",
  "**/merchant-settlement-review.test.ts",
  "**/merchant-settlement-billing-events.test.ts",
  "**/invoice-lifecycle-billing-events.test.ts"
];

const billingB53ConcurrencyTest =
  "**/invoice-lifecycle-concurrency-b53.test.ts";

const billingB54MaterializerTest = "**/platform-billing-notification-materializer-b54.test.ts";
const billingB55PreSendTest = "**/platform-billing-notification-pre-send-b55.test.ts";
const billingB55AttemptFenceTest = "**/platform-billing-notification-attempt-fence-b55.test.ts";
const billingB62ClaimTest = "**/platform-billing-notification-claim-b62.test.ts";
const billingB63IntegrationTest = "**/platform-billing-notification-b63.test.ts";
const billingB64OutcomeTest = "**/platform-billing-notification-outcome.test.ts";
const billingB65RecoveryTest = "**/platform-billing-notification-recovery-b65.test.ts";
const billingB66RuntimeTest = "**/platform-billing-worker-runtime-b66.test.ts";
const billingB635FinalizationTest = "**/platform-billing-notification-finalization-b635.test.ts";
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

    ...(suite === "billing-b53-concurrency"
      ? {
          include: [billingB53ConcurrencyTest, billingB54MaterializerTest, billingB55PreSendTest, billingB55AttemptFenceTest, billingB62ClaimTest, billingB63IntegrationTest, billingB64OutcomeTest, billingB65RecoveryTest, billingB66RuntimeTest, billingB635FinalizationTest, "**/platform-billing-notification-deliveries-route.test.ts", "**/platform-billing-notification-pre-send-cleanup-b6imp1.test.ts","**/platform-billing-notification-pre-send-reconciliation-db.test.ts",
        "**/platform-billing-notification-transport-context-b6imp2a.test.ts",
        "**/platform-billing-bot-credential-verification-b6imp2b.test.ts",
        "**/platform-billing-notification-request-start-integration-b6imp2c.test.ts",
        "**/platform-billing-notification-send-capability-b6imp2e.test.ts"]
        }
      : suite === "bootstrap-concurrency"
        ? {
            include: [concurrencyTest]
          }
      : suite === "billing-telegram-b3"
        ? {
            include: billingTelegramB3Tests
          }
        : {}),

    exclude: [
      "dist/**",
      "node_modules/**",
      ...(suite === "billing-b53-concurrency"
        ? []
        : [
            billingB53ConcurrencyTest,
            billingB54MaterializerTest,
            "**/platform-billing-notification-pre-send-reconciliation-db.test.ts"
          ]),
      ...(suite === "billing-telegram-b3"
        ? []
        : [
            "**/merchant-billing-telegram-db.test.ts",
            "**/merchant-billing-telegram-link-token.test.ts",
            "**/merchant-billing-telegram-redemption-db.test.ts",
            "**/merchant-billing-telegram-preferences-db.test.ts"
          ]),
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
