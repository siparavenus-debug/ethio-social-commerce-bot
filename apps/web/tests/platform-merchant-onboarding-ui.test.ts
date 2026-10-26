import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe("platform merchant onboarding UI contract", () => {
  it("submits onboarding applications instead of creating merchants directly", () => {
    expect(appSource).toContain(
      'title: "Submit merchant onboarding application"'
    );
    expect(appSource).toContain(
      'path: "/merchant-onboarding"'
    );
    expect(appSource).toContain('method: "POST"');
    expect(appSource).toContain(
      "Submitting an application does not create a merchant account."
    );
  });

  it("collects the required merchant and owner contact fields", () => {
    expect(appSource).toMatch(
      /field\(\s*"name",\s*"Merchant name"\s*\)/
    );
    expect(appSource).toMatch(
      /field\(\s*"phone",\s*"Primary phone"\s*\)/
    );
    expect(appSource).toMatch(
      /field\(\s*"ownerEmail",\s*"Owner email",\s*"email"\s*\)/
    );
  });

  it("supports optional contact and owner display fields", () => {
    expect(appSource).toMatch(
      /field\(\s*"alternatePhone",\s*"Alternate phone",\s*"text",\s*true\s*\)/
    );
    expect(appSource).toMatch(
      /field\(\s*"address",\s*"Address",\s*"text",\s*true\s*\)/
    );
    expect(appSource).toMatch(
      /field\(\s*"telegramUsername",\s*"Telegram username",\s*"text",\s*true\s*\)/
    );
    expect(appSource).toMatch(
      /field\(\s*"ownerDisplayName",\s*"Owner display name",\s*"text",\s*true\s*\)/
    );
  });

  it("requires independent approval before merchant creation", () => {
    expect(appSource).toContain(
      "A different authorized platform administrator must approve it."
    );
    expect(appSource).toContain(
      "application.createdById === user.id"
    );
    expect(appSource).toContain(
      'application.status !== "PENDING_APPROVAL"'
    );
    expect(appSource).toContain(
      'user.role === "STAFF"'
    );
    expect(appSource).toContain(
      '/approve`'
    );
  });

  it("uses secure owner activation instead of administrator-assigned passwords", () => {
    expect(appSource).toContain(
      "The merchant owner will set their own password through a secure invitation."
    );
    expect(appSource).toContain(
      "owner activation invitation"
    );
    expect(appSource).not.toContain(
      'field("ownerPassword"'
    );
  });

  it("preserves password input exactly while trimming non-password fields", () => {
    expect(appSource).toMatch(
      /f\.type\s*===\s*"password"\s*\?\s*input\s*:\s*input\.trim\(\)/
    );
  });
});
