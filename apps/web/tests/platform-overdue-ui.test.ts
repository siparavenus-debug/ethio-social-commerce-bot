import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe("platform overdue UI contract", () => {
  it("loads selected-period overdue summary and invoice detail", () => {
    expect(appSource).toContain(
      "/billing/overdue/range-summary?start="
    );

    expect(appSource).toContain(
      "/billing/overdue/range?start="
    );
  });

  it("offers month year and custom overdue periods", () => {
    expect(appSource).toContain(
      "overduePeriodMode"
    );

    expect(appSource).toContain(
      "overdueMonth"
    );

    expect(appSource).toContain(
      "overdueYear"
    );

    expect(appSource).toContain(
      "overdueCustomStart"
    );

    expect(appSource).toContain(
      "overdueCustomEnd"
    );
  });

  it("presents selected-period overdue totals by currency", () => {
    expect(appSource).toContain(
      "Overdue invoices"
    );

    expect(appSource).toContain(
      "Overdue total"
    );

    expect(appSource).toContain(
      "Invoice count"
    );

    expect(appSource).toContain(
      "overdueSummary.currencies.map("
    );
  });
});