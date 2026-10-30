import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe("platform invitation deliveries UI contract", () => {
  it("exposes the Invitation Deliveries section", () => {
    expect(appSource).toContain(
      '"Invitation Deliveries"'
    );

    expect(appSource).toContain(
      "Merchant Invitation Deliveries"
    );
  });

  it("defaults to REVIEW_REQUIRED", () => {
    expect(appSource).toMatch(
      /setInvitationDeliveryStatus\s*\]\s*=\s*useState\("REVIEW_REQUIRED"\)/
    );
  });

  it("supports all six delivery statuses", () => {
    for (const status of [
      "REVIEW_REQUIRED",
      "PENDING",
      "PROCESSING",
      "SENDING",
      "SENT",
      "FAILED"
    ]) {
      expect(appSource).toContain(`"${status}"`);
    }
  });

  it("uses the read-only invitation deliveries endpoint", () => {
    expect(appSource).toContain(
      "/merchant-invitations/deliveries?status="
    );

    expect(appSource).toContain(
      "encodeURIComponent("
    );

    expect(appSource).toMatch(
      /view === "Invitation Deliveries"[\s\S]*?platformRequest<[\s\S]*?"GET"/
    );
  });

  it("displays delivery details using the existing table", () => {
    expect(appSource).toContain(
      "rows={rows.map(row =>"
    );

    for (const column of [
      "merchantName",
      "recipientEmail",
      "status",
      "attemptCount",
      "lastError",
      "updatedAt",
      "nextAttemptAt"
    ]) {
      expect(appSource).toContain(`"${column}"`);
    }
  });

  it("identifies the delivery view as read-only", () => {
    expect(appSource).toContain(
      "This view is read-only."
    );

    expect(appSource).toContain(
      "Provider acceptance does not confirm recipient delivery."
    );
  });
});