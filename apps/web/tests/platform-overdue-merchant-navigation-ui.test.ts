import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe("platform overdue merchant navigation UI contract", () => {
  it("offers merchant management from overdue invoice rows", () => {
    expect(appSource).toContain(
      'view === "Overdue"'
    );

    expect(appSource).toContain(
      "rowMerchantId(r)"
    );

    expect(appSource).toContain(
      "Manage merchant"
    );
  });

  it("opens the existing merchant invoice workflow", () => {
    expect(appSource).toContain(
      'setView("Merchants")'
    );

    expect(appSource).toContain(
      "setSelected(merchantId)"
    );

    expect(appSource).toContain(
      'setLedger("invoices")'
    );
  });
});