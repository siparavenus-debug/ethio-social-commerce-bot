import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe(
  "platform merchant account enforcement UI contract",
  () => {
    it("models the server-authoritative merchant account enforcement fields", () => {
      expect(appSource).toContain(
        "accountStatus: string;"
      );
      expect(appSource).toContain(
        "accountSuspensionReason?: string | null;"
      );
      expect(appSource).toContain(
        "accountSuspendedAt?: string | null;"
      );
    });

    it("presents account enforcement separately from subscription status", () => {
      expect(appSource).toContain(
        ">Account status</h3>"
      );
      expect(appSource).toContain(
        "{merchant.accountStatus}"
      );
      expect(appSource).toContain(
        "merchant.accountSuspensionReason"
      );
      expect(appSource).toContain(
        "merchant.accountSuspendedAt"
      );
    });

    it("uses the dedicated account status endpoint with a required reason", () => {
      expect(appSource).toContain(
        "`${merchantPath}/account/status`"
      );
      expect(appSource).toContain(
        '{ name: "reason", label: "Reason" }'
      );
    });

    it("offers only the account transition allowed by the current state", () => {
      expect(appSource).toContain(
        'merchant.accountStatus === "ACTIVE"'
      );
      expect(appSource).toContain(
        'merchant.accountStatus === "SUSPENDED"'
      );
      expect(appSource).toContain(
        'nextStatus: "SUSPENDED"'
      );
      expect(appSource).toContain(
        'nextStatus: "ACTIVE"'
      );
    });
  }
);