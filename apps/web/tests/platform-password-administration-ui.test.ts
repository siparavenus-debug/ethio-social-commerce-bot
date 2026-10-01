import {
    readFileSync
  } from "node:fs";

  import {
    describe,
    expect,
    it
  } from "vitest";

  const appSource =
    readFileSync(
      new URL(
        "../src/PlatformApp.tsx",
        import.meta.url
      ),
      "utf8"
    );

  describe(
    "platform password administration UI contract",
    () => {
      it(
        "offers authenticated platform administrators a password change action",
        () => {
          expect(
            appSource
          ).toContain(
            "Change password"
          );

          expect(
            appSource
          ).toContain(
            'name="currentPassword"'
          );

          expect(
            appSource
          ).toContain(
            'name="newPassword"'
          );
        }
      );

      it(
        "uses the protected platform password endpoint",
        () => {
          expect(
            appSource
          ).toContain(
            '"/auth/password"'
          );
        }
      );

      it(
        "ends the current platform session after a successful password change",
        () => {
          expect(
            appSource
          ).toContain(
            "logout();"
          );
        }
      );
    }
  );
