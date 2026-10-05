import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

import { env } from "../config/env.js";

const CREDENTIAL_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  return createHash("sha256")
    .update(
      env.telegramCredentialEncryptionKey,
      "utf8"
    )
    .digest();
}

export function encryptTelegramCredential(
  plaintext: string
): string {
  if (!plaintext) {
    throw new Error(
      "Telegram credential is required."
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
    CREDENTIAL_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url")
  ].join(".");
}

export function decryptTelegramCredential(
  encryptedValue: string
): string {
  const parts = encryptedValue.split(".");

  if (
    parts.length !== 4 ||
    parts[0] !== CREDENTIAL_VERSION
  ) {
    throw new Error(
      "Invalid Telegram credential format."
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
        "Invalid initialization vector."
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
      "Unable to decrypt Telegram credential."
    );
  }
}
