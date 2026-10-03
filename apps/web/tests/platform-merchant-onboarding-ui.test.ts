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
    "platform merchant onboarding UI contract",
    () => {
      it(
        "offers platform administrators a merchant creation action",
        () => {
          expect(
            appSource
          ).toContain(
            "Create merchant"
          );

          expect(
            appSource
          ).toContain(
            'path: "/merchants"'
          );

          expect(
            appSource
          ).toContain(
            'method: "POST"'
          );
        }
      );

      it(
        "collects the merchant and initial owner fields required by the onboarding endpoint",
        () => {
          expect(
            appSource
          ).toMatch(
            /field\(\s*"name",\s*"Merchant name"\s*\)/
          );

          expect(
            appSource
          ).toMatch(
            /field\(\s*"currency",\s*"Currency \(3-letter code\)"\s*\)/
          );

          expect(
            appSource
          ).toMatch(
            /field\(\s*"ownerEmail",\s*"Owner email",\s*"email"\s*\)/
          );

          expect(
            appSource
          ).toMatch(
            /field\(\s*"ownerPassword",\s*"Owner password",\s*"password"\s*\)/
          );
        }
      );

      it(
        "supports the optional merchant contact and owner display fields",
        () => {
          expect(
            appSource
          ).toMatch(
            /field\(\s*"phone",\s*"Phone",\s*"text",\s*true\s*\)/
          );

          expect(
            appSource
          ).toMatch(
            /field\(\s*"alternatePhone",\s*"Alternate phone",\s*"text",\s*true\s*\)/
          );

          expect(
            appSource
          ).toMatch(
            /field\(\s*"address",\s*"Address",\s*"text",\s*true\s*\)/
          );

          expect(
            appSource
          ).toMatch(
            /field\(\s*"ownerDisplayName",\s*"Owner display name",\s*"text",\s*true\s*\)/
          );
        }
      );

      it(
        "keeps subscription initialization separate from merchant creation",
        () => {
          expect(
            appSource
          ).toContain(
            "Subscription is initialized separately after the merchant account is created."
          );
        }
      );

      it(
        "preserves password input exactly while trimming non-password fields",
        () => {
          expect(
            appSource
          ).toMatch(
            /f\.type\s*===\s*"password"\s*\?\s*input\s*:\s*input\.trim\(\)/
          );
        }
      );
    }
  );
