
import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes
  } from "node:crypto";

  import dotenv from "dotenv";
  import path from "node:path";

  dotenv.config({
    path: path.resolve(process.cwd(), ".env"),
    override: false
  });

  const ENCRYPTION_VERSION = "v1";
  const ALGORITHM = "aes-256-gcm";
  const IV_LENGTH = 12;

  function getEncryptionKey(): Buffer {
    const encryptionKey =
      process.env.MERCHANT_INVITATION_ENCRYPTION_KEY?.trim();

    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error(
        "MERCHANT_INVITATION_ENCRYPTION_KEY must be configured and contain at least 32 characters."
      );
    }

    return createHash("sha256")
      .update(encryptionKey, "utf8")
      .digest();
  }

  export function encryptMerchantInvitation(
    plaintext: string
  ): string {
    if (!plaintext) {
      throw new Error(
        "Merchant invitation token is required."
      );
    }

    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(
      ALGORITHM,
      getEncryptionKey(),
      iv
    );

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return [
      ENCRYPTION_VERSION,
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      authTag.toString("base64url")
    ].join(".");
  }

  export function decryptMerchantInvitation(
    encryptedValue: string
  ): string {
    const parts = encryptedValue.split(".");

    if (
      parts.length !== 4 ||
      parts[0] !== ENCRYPTION_VERSION
    ) {
      throw new Error(
        "Invalid merchant invitation format."
      );
    }

    try {
      const iv = Buffer.from(
        parts[1],
        "base64url"
      );

      const ciphertext = Buffer.from(
        parts[2],
        "base64url"
      );

      const authTag = Buffer.from(
        parts[3],
        "base64url"
      );

      if (iv.length !== IV_LENGTH) {
        throw new Error(
          "Invalid merchant invitation initialization vector."
        );
      }

      const decipher = createDecipheriv(
        ALGORITHM,
        getEncryptionKey(),
        iv
      );

      decipher.setAuthTag(authTag);

      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]).toString("utf8");
    } catch {
      throw new Error(
        "Unable to decrypt merchant invitation."
      );
    }
  }
