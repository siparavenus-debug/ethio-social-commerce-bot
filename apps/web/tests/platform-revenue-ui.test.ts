import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe("platform revenue UI contract", () => {
  it("loads monthly collected revenue without replacing paid invoice history", () => {
    expect(appSource).toContain(
      "\"/billing/revenue\""
    );

    expect(appSource).toContain(
      "`/billing/revenue/monthly-summary?month=${month}`"
    );
  });

  it("presents current-month collected revenue by currency", () => {
    expect(appSource).toContain(
      "Current month collected revenue"
    );

    expect(appSource).toContain(
      "Collected subscription"
    );

    expect(appSource).toContain(
      "Collected commission"
    );

    expect(appSource).toContain(
      "Collected total"
    );

    expect(appSource).toContain(
      "revenueSummary.currencies.map("
    );
  });
});