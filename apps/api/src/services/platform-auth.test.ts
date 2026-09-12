import {
    describe,
    expect,
    it
  } from "vitest";

  import {
    createAuthToken,
    verifyAuthToken
  } from "./auth.js";

  import {
    createPlatformAuthToken,
    verifyPlatformAuthToken
  } from "./platform-auth.js";

  describe(
    "platform authentication token boundary",
    () => {
      it(
        "creates and verifies a platform token",
        () => {
          const token =
            createPlatformAuthToken({
              id: "platform-user-1",
              tokenVersion: 3
            });

          expect(
            token.startsWith("platform-v1.")
          ).toBe(true);

          const payload =
            verifyPlatformAuthToken(token);

          expect(payload).not.toBeNull();

          expect(
            payload?.platformUserId
          ).toBe("platform-user-1");

          expect(
            payload?.tokenVersion
          ).toBe(3);

          expect(
            payload?.issuedAt
          ).toEqual(expect.any(Number));

          expect(
            payload?.expiresAt
          ).toEqual(expect.any(Number));

          expect(
            payload!.expiresAt
          ).toBeGreaterThan(
            payload!.issuedAt
          );
        }
      );

      it(
        "rejects a merchant token as a platform token",
        () => {
          const merchantToken =
            createAuthToken({
              id: "merchant-user-1",
              merchantId: "merchant-1",
              role: "OWNER",
              tokenVersion: 0
            });

          expect(
            verifyPlatformAuthToken(
              merchantToken
            )
          ).toBeNull();
        }
      );

      it(
        "rejects a platform token as a merchant token",
        () => {
          const platformToken =
            createPlatformAuthToken({
              id: "platform-user-1",
              tokenVersion: 0
            });

          expect(
            verifyAuthToken(
              platformToken
            )
          ).toBeNull();
        }
      );

      it(
        "rejects a tampered platform token",
        () => {
          const token =
            createPlatformAuthToken({
              id: "platform-user-1",
              tokenVersion: 0
            });

          const parts =
            token.split(".");

          expect(parts).toHaveLength(3);

          const tamperedPayload =
            parts[1].endsWith("A")
              ? `${parts[1].slice(0, -1)}B`
              : `${parts[1].slice(0, -1)}A`;

          const tamperedToken =
            `${parts[0]}.${tamperedPayload}.${parts[2]}`;

          expect(
            verifyPlatformAuthToken(
              tamperedToken
            )
          ).toBeNull();
        }
      );

      it(
        "rejects an invalid platform token format",
        () => {
          expect(
            verifyPlatformAuthToken("")
          ).toBeNull();

          expect(
            verifyPlatformAuthToken(
              "platform-v1.invalid"
            )
          ).toBeNull();

          expect(
            verifyPlatformAuthToken(
              "v1.invalid.invalid"
            )
          ).toBeNull();
        }
      );
    }
  );
