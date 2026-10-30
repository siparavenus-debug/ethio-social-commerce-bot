// @vitest-environment jsdom

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
  } from "@testing-library/react";

  import PlatformApp from "../src/PlatformApp.js";

  describe("platform invitation deliveries interaction", () => {
    beforeEach(() => {
      sessionStorage.clear();
    });

    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
      sessionStorage.clear();
    });

    it("loads REVIEW_REQUIRED deliveries by default", async () => {
      const fetchMock = vi.spyOn(
        globalThis,
        "fetch"
      ).mockImplementation(async (input, init) => {
        const url = String(input);

        if (url.endsWith("/platform/auth/login")) {
          return new Response(
            JSON.stringify({ token: "platform-token" }),
            { status: 200 }
          );
        }

        if (url.endsWith("/platform/auth/me")) {
          return new Response(
            JSON.stringify({
              user: {
                id: "operator-a",
                email: "operator@example.com",
                displayName: "Platform Operator",
                role: "ADMIN"
              }
            }),
            { status: 200 }
          );
        }

        if (url.endsWith("/platform/merchants")) {
          return new Response(
            JSON.stringify({ merchants: [] }),
            { status: 200 }
          );
        }

        if (url.endsWith("/platform/plans")) {
          return new Response(
            JSON.stringify({ plans: [] }),
            { status: 200 }
          );
        }

        if (
          url.endsWith(
            "/platform/merchant-invitations/deliveries?status=REVIEW_REQUIRED"
          )
        ) {
          expect(
            new Headers(init?.headers).get("Authorization")
          ).toBe("Bearer platform-token");

          expect(init?.method ?? "GET").toBe("GET");

          return new Response(
            JSON.stringify({
              deliveries: [{
                id: "delivery-a",
                recipientEmail: "owner@example.com",
                status: "REVIEW_REQUIRED",
                attemptCount: 2,
                lastError: "Provider outcome uncertain",
                updatedAt: "2026-10-30T10:00:00.000Z",
                nextAttemptAt: null,
                providerMessageId: null,
                activation: {
                  merchant: {
                    id: "merchant-a",
                    name: "Addis Electronics"
                  }
                }
              }]
            }),
            { status: 200 }
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      });

      render(<PlatformApp />);

      fireEvent.change(
        screen.getByLabelText("Email"),
        { target: { value: "operator@example.com" } }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        { target: { value: "test-password" } }
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Sign in" })
      );

      await screen.findByText("Platform Operator");

      fireEvent.click(
        screen.getByRole("button", {
          name: "Invitation Deliveries"
        })
      );

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([input]) =>
            String(input).endsWith(
              "/platform/merchant-invitations/deliveries?status=REVIEW_REQUIRED"
            )
          )
        ).toBe(true);
      });

      expect(
        await screen.findByText("Addis Electronics")
      ).toBeTruthy();

      expect(
        screen.getByText("owner@example.com")
      ).toBeTruthy();

      expect(
        screen.getByText("Provider outcome uncertain")
      ).toBeTruthy();

      expect(
        (
          screen.getByLabelText(
            "Delivery status"
          ) as HTMLSelectElement
        ).value
      ).toBe("REVIEW_REQUIRED");
    });

    it("reloads deliveries when the status filter changes", async () => {
        const requestedStatuses: string[] = [];

        vi.spyOn(globalThis, "fetch").mockImplementation(
          async (input, init) => {
            const url = String(input);

            if (url.endsWith("/platform/auth/login")) {
              return new Response(
                JSON.stringify({ token: "platform-token" }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/auth/me")) {
              return new Response(
                JSON.stringify({
                  user: {
                    id: "operator-a",
                    email: "operator@example.com",
                    displayName: "Platform Operator",
                    role: "ADMIN"
                  }
                }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/merchants")) {
              return new Response(
                JSON.stringify({ merchants: [] }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/plans")) {
              return new Response(
                JSON.stringify({ plans: [] }),
                { status: 200 }
              );
            }

            const prefix =
              "/platform/merchant-invitations/deliveries?status=";

            if (url.includes(prefix)) {
              expect(
                new Headers(init?.headers).get("Authorization")
              ).toBe("Bearer platform-token");

              expect(init?.method ?? "GET").toBe("GET");

              const status = url.split(prefix)[1];
              requestedStatuses.push(status);

              return new Response(
                JSON.stringify({
                  deliveries: [{
                    id: `delivery-${status}`,
                    recipientEmail:
                      status === "FAILED"
                        ? "failed@example.com"
                        : "review@example.com",
                    status,
                    attemptCount: 1,
                    lastError: null,
                    updatedAt: "2026-10-30T10:00:00.000Z",
                    nextAttemptAt: null,
                    activation: {
                      merchant: {
                        id: "merchant-a",
                        name: "Addis Electronics"
                      }
                    }
                  }]
                }),
                { status: 200 }
              );
            }

            throw new Error(`Unexpected request: ${url}`);
          }
        );

        render(<PlatformApp />);

        fireEvent.change(
          screen.getByLabelText("Email"),
          { target: { value: "operator@example.com" } }
        );

        fireEvent.change(
          screen.getByLabelText("Password"),
          { target: { value: "test-password" } }
        );

        fireEvent.click(
          screen.getByRole("button", { name: "Sign in" })
        );

        await screen.findByText("Platform Operator");

        fireEvent.click(
          screen.getByRole("button", {
            name: "Invitation Deliveries"
          })
        );

        expect(
          await screen.findByText("review@example.com")
        ).toBeTruthy();

        fireEvent.change(
          screen.getByLabelText("Delivery status"),
          { target: { value: "FAILED" } }
        );

        expect(
          await screen.findByText("failed@example.com")
        ).toBeTruthy();

        await waitFor(() => {
          expect(
            screen.queryByText("review@example.com")
          ).toBeNull();
        });

        expect(requestedStatuses).toContain("REVIEW_REQUIRED");
        expect(requestedStatuses).toContain("FAILED");

        expect(
          (
            screen.getByLabelText(
              "Delivery status"
            ) as HTMLSelectElement
          ).value
        ).toBe("FAILED");
      });

      it("shows an empty state when no deliveries match", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          async (input, init) => {
            const url = String(input);

            if (url.endsWith("/platform/auth/login")) {
              return new Response(
                JSON.stringify({ token: "platform-token" }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/auth/me")) {
              return new Response(
                JSON.stringify({
                  user: {
                    id: "operator-a",
                    email: "operator@example.com",
                    displayName: "Platform Operator",
                    role: "ADMIN"
                  }
                }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/merchants")) {
              return new Response(
                JSON.stringify({ merchants: [] }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/plans")) {
              return new Response(
                JSON.stringify({ plans: [] }),
                { status: 200 }
              );
            }

            if (
              url.endsWith(
                "/platform/merchant-invitations/deliveries?status=REVIEW_REQUIRED"
              )
            ) {
              expect(
                new Headers(init?.headers).get("Authorization")
              ).toBe("Bearer platform-token");

              return new Response(
                JSON.stringify({ deliveries: [] }),
                { status: 200 }
              );
            }

            throw new Error(`Unexpected request: ${url}`);
          }
        );

        render(<PlatformApp />);

        fireEvent.change(
          screen.getByLabelText("Email"),
          { target: { value: "operator@example.com" } }
        );

        fireEvent.change(
          screen.getByLabelText("Password"),
          { target: { value: "test-password" } }
        );

        fireEvent.click(
          screen.getByRole("button", { name: "Sign in" })
        );

        await screen.findByText("Platform Operator");

        fireEvent.click(
          screen.getByRole("button", {
            name: "Invitation Deliveries"
          })
        );

        expect(
          await screen.findByText("No records found.")
        ).toBeTruthy();

        expect(
          screen.getByText("Merchant Invitation Deliveries")
        ).toBeTruthy();

        expect(
          (
            screen.getByLabelText(
              "Delivery status"
            ) as HTMLSelectElement
          ).value
        ).toBe("REVIEW_REQUIRED");
      });

      it("displays an error when invitation delivery loading fails", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          async (input, init) => {
            const url = String(input);

            if (url.endsWith("/platform/auth/login")) {
              return new Response(
                JSON.stringify({ token: "platform-token" }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/auth/me")) {
              return new Response(
                JSON.stringify({
                  user: {
                    id: "operator-a",
                    email: "operator@example.com",
                    displayName: "Platform Operator",
                    role: "ADMIN"
                  }
                }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/merchants")) {
              return new Response(
                JSON.stringify({ merchants: [] }),
                { status: 200 }
              );
            }

            if (url.endsWith("/platform/plans")) {
              return new Response(
                JSON.stringify({ plans: [] }),
                { status: 200 }
              );
            }

            if (
              url.endsWith(
                "/platform/merchant-invitations/deliveries?status=REVIEW_REQUIRED"
              )
            ) {
              expect(
                new Headers(init?.headers).get("Authorization")
              ).toBe("Bearer platform-token");

              return new Response(
                JSON.stringify({
                  error: "Unable to load invitation deliveries"
                }),
                { status: 500 }
              );
            }

            throw new Error(`Unexpected request: ${url}`);
          }
        );

        render(<PlatformApp />);

        fireEvent.change(
          screen.getByLabelText("Email"),
          { target: { value: "operator@example.com" } }
        );

        fireEvent.change(
          screen.getByLabelText("Password"),
          { target: { value: "test-password" } }
        );

        fireEvent.click(
          screen.getByRole("button", { name: "Sign in" })
        );

        await screen.findByText("Platform Operator");

        fireEvent.click(
          screen.getByRole("button", {
            name: "Invitation Deliveries"
          })
        );

        expect(
          await screen.findByText(
            "Unable to load invitation deliveries"
          )
        ).toBeTruthy();

        expect(
            screen.getByText(
              "Use Refresh to retry loading current records."
            )
          ).toBeTruthy();

          expect(
            screen.queryByText("No records found.")
          ).toBeNull();

          expect(
            screen.getByRole("button", {
              name: "Refresh"
            })
          ).toBeTruthy();
      });

      it("opens a sanitized full delivery record without mutation actions", async () => {
        const fetchMock = vi.spyOn(
          globalThis,
          "fetch"
        ).mockImplementation(async (input) => {
          const url = String(input);

          if (url.endsWith("/platform/auth/login")) {
            return new Response(
              JSON.stringify({ token: "platform-token" }),
              { status: 200 }
            );
          }

          if (url.endsWith("/platform/auth/me")) {
            return new Response(
              JSON.stringify({
                user: {
                  id: "operator-a",
                  email: "operator@example.com",
                  displayName: "Platform Operator",
                  role: "ADMIN"
                }
              }),
              { status: 200 }
            );
          }

          if (url.endsWith("/platform/merchants")) {
            return new Response(
              JSON.stringify({ merchants: [] }),
              { status: 200 }
            );
          }

          if (url.endsWith("/platform/plans")) {
            return new Response(
              JSON.stringify({ plans: [] }),
              { status: 200 }
            );
          }

          if (
            url.endsWith(
              "/platform/merchant-invitations/deliveries?status=REVIEW_REQUIRED"
            )
          ) {
            return new Response(
              JSON.stringify({
                deliveries: [{
                  id: "delivery-a",
                  recipientEmail: "owner@example.com",
                  status: "REVIEW_REQUIRED",
                  attemptCount: 2,
                  lastError: "Provider outcome uncertain",
                  providerMessageId: "provider-message-123",
                  updatedAt: "2026-10-30T10:00:00.000Z",
                  nextAttemptAt: null,
                  activation: {
                    merchant: {
                      id: "merchant-a",
                      name: "Addis Electronics"
                    }
                  }
                }]
              }),
              { status: 200 }
            );
          }

          throw new Error(`Unexpected request: ${url}`);
        });

        render(<PlatformApp />);

        fireEvent.change(
          screen.getByLabelText("Email"),
          { target: { value: "operator@example.com" } }
        );

        fireEvent.change(
          screen.getByLabelText("Password"),
          { target: { value: "test-password" } }
        );

        fireEvent.click(
          screen.getByRole("button", { name: "Sign in" })
        );

        await screen.findByText("Platform Operator");

        fireEvent.click(
          screen.getByRole("button", {
            name: "Invitation Deliveries"
          })
        );

        await screen.findByText("Addis Electronics");

        fireEvent.click(
          screen.getByRole("button", { name: "Full record" })
        );

        const dialog = screen.getByRole("dialog");

        expect(dialog.textContent).toContain(
          "provider-message-123"
        );

        expect(dialog.textContent).toContain(
          "Addis Electronics"
        );

        expect(dialog.textContent).toContain(
          "owner@example.com"
        );

        expect(dialog.textContent).not.toMatch(
          /encryptedToken|tokenHash|activationToken|webhookSecret/
        );

        for (const action of [
          "Resend",
          "Retry",
          "Approve",
          "Reject",
          "Verify"
        ]) {
          expect(
            screen.queryByRole("button", { name: action })
          ).toBeNull();
        }

        fireEvent.click(
          screen.getByRole("button", { name: "Close" })
        );

        expect(screen.queryByRole("dialog")).toBeNull();

        const deliveryRequests = fetchMock.mock.calls.filter(
          ([input]) =>
            String(input).includes(
              "/platform/merchant-invitations/deliveries"
            )
        );

        expect(deliveryRequests).toHaveLength(1);
      });
  });