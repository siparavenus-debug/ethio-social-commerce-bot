
import {
    describe,
    expect,
    it
  } from "vitest";

  import {
    decryptMerchantInvitation,
    encryptMerchantInvitation
  } from "../src/services/merchant-invitation-encryption.js";

  describe("merchant invitation encryption", () => {
    it("encrypts and decrypts an invitation token", () => {
      const token = "merchant-owner-activation-test-token";

      const encrypted = encryptMerchantInvitation(token);

      expect(encrypted).not.toBe(token);
      expect(encrypted.startsWith("v1.")).toBe(true);
      expect(decryptMerchantInvitation(encrypted)).toBe(token);
    });

    it("produces different ciphertext for the same token", () => {
      const token = "same-invitation-token";

      const first = encryptMerchantInvitation(token);
      const second = encryptMerchantInvitation(token);

      expect(first).not.toBe(second);

      expect(decryptMerchantInvitation(first)).toBe(token);
      expect(decryptMerchantInvitation(second)).toBe(token);
    });

    it("rejects tampered ciphertext", () => {
      const encrypted = encryptMerchantInvitation(
        "sensitive-activation-token"
      );

      const parts = encrypted.split(".");
      const ciphertext = Buffer.from(
        parts[2],
        "base64url"
      );

      ciphertext[0] ^= 1;
      parts[2] = ciphertext.toString("base64url");

      expect(() =>
        decryptMerchantInvitation(parts.join("."))
      ).toThrow();
    });

    it("rejects malformed encrypted invitations", () => {
      expect(() =>
        decryptMerchantInvitation("invalid-token")
      ).toThrow();

      expect(() =>
        decryptMerchantInvitation("v2.invalid.data.tag")
      ).toThrow();
    });

    it("rejects empty invitation tokens", () => {
      expect(() =>
        encryptMerchantInvitation("")
      ).toThrow();
    });
  });
