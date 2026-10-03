import { describe, expect, it } from "vitest";

import {
  validateAuthSecretSeparation
} from "../src/config/env.js";

import {
  createAuthToken,
  hashPassword,
  verifyAuthToken,
  verifyPassword
} from "../src/services/auth.js";

import {
  createPlatformAuthToken,
  verifyPlatformAuthToken
} from "../src/services/platform-auth.js";

describe("authentication security", () => {
  it("accepts different merchant and platform authentication secrets", () => {
    expect(() =>
      validateAuthSecretSeparation(
        "merchant-secret-that-is-at-least-32-characters",
        "platform-secret-that-is-at-least-32-characters"
      )
    ).not.toThrow();
  });

  it("rejects identical merchant and platform authentication secrets", () => {
    const sharedSecret =
      "shared-secret-that-is-at-least-32-characters";

    expect(() =>
      validateAuthSecretSeparation(
        sharedSecret,
        sharedSecret
      )
    ).toThrow(
      "AUTH_SECRET and PLATFORM_AUTH_SECRET must be different."
    );
  });

  it("hashes a password and verifies the correct password", async () => {
    const password = "CorrectPassword123!";

    const hash = await hashPassword(password);

    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword(password, hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword(
      "CorrectPassword123!"
    );

    expect(
      await verifyPassword(
        "WrongPassword123!",
        hash
      )
    ).toBe(false);
  });

  it("rejects malformed password hashes safely", async () => {
    expect(
      await verifyPassword(
        "CorrectPassword123!",
        "not-a-valid-password-hash"
      )
    ).toBe(false);
  });

  it("creates and verifies an authentication token", () => {
    const token = createAuthToken({
      id: "user-123",
      merchantId: "merchant-123",
      role: "OWNER",
      tokenVersion: 1
    });

    const payload = verifyAuthToken(token);

    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("user-123");
    expect(payload?.merchantId).toBe("merchant-123");
    expect(payload?.role).toBe("OWNER");
  });

  it("creates and verifies a platform authentication token", () => {
    const token = createPlatformAuthToken({
      id: "platform-user-123",
      tokenVersion: 1
    });

    const payload =
      verifyPlatformAuthToken(token);

    expect(payload).not.toBeNull();
    expect(
      payload?.platformUserId
    ).toBe("platform-user-123");
    expect(
      payload?.tokenVersion
    ).toBe(1);
  });

  it("rejects a merchant token as a platform authentication token", () => {
    const token = createAuthToken({
      id: "user-123",
      merchantId: "merchant-123",
      role: "OWNER",
      tokenVersion: 1
    });

    expect(
      verifyPlatformAuthToken(token)
    ).toBeNull();
  });

  it("rejects a platform token as a merchant authentication token", () => {
    const token =
      createPlatformAuthToken({
        id: "platform-user-123",
        tokenVersion: 1
      });

    expect(
      verifyAuthToken(token)
    ).toBeNull();
  });

  it("rejects a tampered authentication token", () => {
    const token = createAuthToken({
      id: "user-123",
      merchantId: "merchant-123",
      role: "OWNER",
      tokenVersion: 1
    });

    const parts = token.split(".");

    parts[1] = `${parts[1]}tampered`;

    const tamperedToken = parts.join(".");

    expect(
      verifyAuthToken(tamperedToken)
    ).toBeNull();
  });

  it("rejects a malformed authentication token", () => {
    expect(
      verifyAuthToken("not-a-valid-token")
    ).toBeNull();
  });
});