import {
  describe,
  expect,
  it
} from "vitest";

import {
  decryptTelegramCredential,
  encryptTelegramCredential
} from "./telegram-credential-encryption.js";

describe(
  "Telegram credential encryption",
  () => {
    it(
      "encrypts and decrypts a credential",
      () => {
        const plaintext =
          "123456789:example-telegram-bot-token";

        const encrypted =
          encryptTelegramCredential(
            plaintext
          );

        expect(encrypted).not.toBe(
          plaintext
        );

        expect(
          encrypted.startsWith("v1.")
        ).toBe(true);

        expect(
          decryptTelegramCredential(
            encrypted
          )
        ).toBe(plaintext);
      }
    );

    it(
      "uses a unique initialization vector for each encryption",
      () => {
        const plaintext =
          "same-telegram-credential";

        const first =
          encryptTelegramCredential(
            plaintext
          );

        const second =
          encryptTelegramCredential(
            plaintext
          );

        expect(first).not.toBe(second);

        expect(
          decryptTelegramCredential(first)
        ).toBe(plaintext);

        expect(
          decryptTelegramCredential(second)
        ).toBe(plaintext);
      }
    );

    it(
      "rejects tampered ciphertext",
      () => {
        const encrypted =
          encryptTelegramCredential(
            "telegram-secret"
          );

        const parts =
          encrypted.split(".");

        const ciphertext =
          Buffer.from(
            parts[2],
            "base64url"
          );

        ciphertext[0] ^= 1;

        const tampered = [
          parts[0],
          parts[1],
          ciphertext.toString("base64url"),
          parts[3]
        ].join(".");

        expect(() =>
          decryptTelegramCredential(
            tampered
          )
        ).toThrow(
          "Unable to decrypt Telegram credential."
        );
      }
    );

    it(
      "rejects an invalid credential format",
      () => {
        expect(() =>
          decryptTelegramCredential(
            "invalid"
          )
        ).toThrow(
          "Invalid Telegram credential format."
        );

        expect(() =>
          decryptTelegramCredential(
            "v2.a.b.c"
          )
        ).toThrow(
          "Invalid Telegram credential format."
        );
      }
    );

    it(
      "rejects an empty plaintext credential",
      () => {
        expect(() =>
          encryptTelegramCredential("")
        ).toThrow(
          "Telegram credential is required."
        );
      }
    );
  }
);
