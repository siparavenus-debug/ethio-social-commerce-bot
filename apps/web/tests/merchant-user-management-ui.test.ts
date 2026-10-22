import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

describe("OWNER merchant user management UI contract", () => {
  it("restricts merchant user management to OWNER", () => {
    expect(appSource).toContain(
      'const canManageUsers ='
    );
    expect(appSource).toContain(
      'role === "OWNER";'
    );
    expect(appSource).toContain(
      '{canManageUsers && ('
    );
  });

  it("guards restricted tab content during rendering", () => {
    expect(appSource).toMatch(
      /\{activeTab ===\s*"payments"\s*&&\s*canReviewPayments\s*\?\s*\(/
    );
    expect(appSource).toMatch(
      /activeTab ===\s*"billing"\s*&&\s*canViewBilling\s*\?\s*\(/
    );
    expect(appSource).toMatch(
      /activeTab ===\s*"users"\s*&&\s*canManageUsers\s*\?\s*\(/
    );
  });
  it("guards Telegram content and redirects unauthorized access", () => {
    expect(appSource).toMatch(
      /activeTab ===\s*"telegram"\s*&&\s*canManageTelegram\s*\?\s*\(/
    );

    expect(appSource).toMatch(
      /!canManageTelegram\s*&&\s*activeTab === "telegram"[\s\S]*?setActiveTab\("orders"\)/
    );

    expect(appSource).toMatch(
      /authValidated,\s*canReviewPayments,\s*canViewBilling,\s*canManageUsers,\s*canManageTelegram,\s*activeTab/
    );
  });
  it("uses the merchant-scoped users endpoint", () => {
    expect(appSource).toContain(
      '`/merchants/${merchantId}/users`'
    );
    expect(appSource).toContain(
      '`/merchants/${merchantId}/users/${editingUserId}`'
    );
    expect(appSource).toContain(
      '`/merchants/${merchantId}/users/${merchantUser.id}`'
    );
  });

  it("only offers ADMIN and STAFF for managed user roles", () => {
    expect(appSource).toContain(
      '<option value="STAFF">'
    );
    expect(appSource).toContain(
      '<option value="ADMIN">'
    );
    expect(appSource).not.toContain(
      '<option value="OWNER">'
    );
  });

  it("protects the OWNER account from edit and delete controls", () => {
    expect(appSource).toContain(
      'merchantUser.role !== "OWNER"'
    );
    expect(appSource).toContain(
      'merchantUser.role === "OWNER"'
    );
    expect(appSource).toContain(
      "The owner account cannot be deleted."
    );
  });

  it("supports create edit password reset and delete operations", () => {
    expect(appSource).toContain(
      "async function createUser()"
    );
    expect(appSource).toContain(
      "async function updateUser()"
    );
    expect(appSource).toContain(
      "async function deleteUser("
    );
    expect(appSource).toContain(
      "New password"
    );
    expect(appSource).toContain(
      "Leave blank to keep current password"
    );
  });

  it("does not expose backend user security fields", () => {
    expect(appSource).not.toContain(
      "passwordHash"
    );
    expect(appSource).not.toContain(
      "tokenVersion"
    );
  });

  it("does not persist user passwords in browser storage", () => {
    expect(appSource).not.toContain(
      'localStorage.setItem("newUserPassword"'
    );
    expect(appSource).not.toContain(
      'localStorage.setItem("editUserPassword"'
    );
  });
});