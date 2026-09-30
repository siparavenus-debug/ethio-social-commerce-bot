import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe("platform revenue UI contract", () => {
  it("loads selected-period revenue without replacing paid invoice history", () => {
    expect(appSource).toContain(
      "\"/billing/revenue\""
    );

    expect(appSource).toContain(
      "/billing/revenue/range-summary?start="
    );
  });

  it("offers month year and custom revenue periods", () => {
    expect(appSource).toContain(
      "Month"
    );

    expect(appSource).toContain(
      "Year"
    );

    expect(appSource).toContain(
      "Custom range"
    );

    expect(appSource).toContain(
      "type=\"month\""
    );

    expect(appSource).toContain(
      "type=\"date\""
    );
  });

  it("presents selected-period collected revenue by currency", () => {
    expect(appSource).toContain(
      "Collected revenue"
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

  it("uses the selected revenue range for the invoice table", () => {
    expect(appSource).toContain(
      "/billing/revenue/range?start="
    );

    expect(appSource).toContain(
      "data = rangeRevenue.invoices;"
    );
  });
});