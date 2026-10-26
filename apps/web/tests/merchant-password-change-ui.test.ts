import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

describe("merchant self-service password change UI contract", () => {
  it("exposes password change to authenticated merchant users without a role gate", () => {
    expect(appSource).toContain(
      "Change password"
    );
    expect(appSource).toContain(
      "setChangingPassword(true);"
    );
    expect(appSource).toContain(
      "{changingPassword && ("
    );
  });

  it("collects current new and confirmation passwords securely", () => {
    expect(appSource).toContain(
      'name="currentPassword"'
    );
    expect(appSource).toContain(
      'autoComplete="current-password"'
    );
    expect(appSource).toContain(
      'name="newPassword"'
    );
    expect(appSource).toContain(
      'name="confirmPassword"'
    );
    expect(appSource).toContain(
      'autoComplete="new-password"'
    );
    expect(appSource).toContain(
      "newPassword !== confirmPassword"
    );
  });

  it("uses the authenticated self-service password endpoint", () => {
    expect(appSource).toContain(
      '"/auth/password"'
    );
    expect(appSource).toContain(
      'method: "PATCH"'
    );
    expect(appSource).toContain(
      "currentPassword,"
    );
    expect(appSource).toContain(
      "newPassword"
    );
  });

  it("requires at least eight characters for the new password", () => {
    expect(appSource).toContain(
      "newPassword.length < 8"
    );
    expect(appSource).toContain(
      "New password must be at least 8 characters."
    );
    expect(appSource).toContain(
      "minLength={8}"
    );
  });

  it("signs the merchant out after successful password rotation", () => {
    expect(appSource).toContain(
      "async function changePassword("
    );
    expect(appSource).toContain(
      "logout();"
    );
    expect(appSource).toContain(
      "Changing your password"
    );
    expect(appSource).toContain(
      "will sign you out of your"
    );
  });

  it("dismisses the password modal only on backdrop clicks", () => {
    const modal = appSource.match(
      /{changingPassword && \([\s\S]*?{categoryImagePreview && \(/
    )?.[0];

    expect(modal).toBeDefined();
    expect(modal).toContain(
      'aria-label="Close password dialog"'
    );
    expect(modal).toContain(
      'type="button"'
    );
    expect(modal).toContain(
      "disabled={changingPasswordLoading}"
    );
    expect(modal).toContain(
      "!changingPasswordLoading"
    );
    expect(modal).not.toContain(
      "event.stopPropagation()"
    );
  });
  it("does not persist self-service passwords in browser storage", () => {
    expect(appSource).not.toContain(
      'localStorage.setItem("currentPassword"'
    );
    expect(appSource).not.toContain(
      'localStorage.setItem("newPassword"'
    );
    expect(appSource).not.toContain(
      'localStorage.setItem("confirmPassword"'
    );
  });
});