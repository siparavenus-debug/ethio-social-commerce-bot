
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

  import App from "../src/App.js";

  describe("merchant billing Telegram UI", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
      localStorage.clear();
    });

    it("shows billing Telegram status to OWNER", async () => {
      const fetchMock = vi.spyOn(
        globalThis,
        "fetch"
      ).mockImplementation(async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return new Response(
            JSON.stringify({
              token: "owner-token",
              user: {
                id: "owner-user",
                merchantId: "merchant-a",
                email: "owner@example.com",
                displayName: "Merchant Owner",
                role: "OWNER"
              }
            }),
            { status: 200 }
          );
        }

        if (
          url.endsWith(
            "/merchants/merchant-a/billing-telegram"
          )
        ) {
          return new Response(
            JSON.stringify({
              linked: false,
              destination: null
            }),
            { status: 200 }
          );
        }

        if (
            url.endsWith(
              "/merchants/merchant-a/billing/summary"
            )
          ) {
            return new Response(
              JSON.stringify({
                merchantId: "merchant-a",
                subscription: null,
                currentPeriod: {
                  status: "NO_SUBSCRIPTION"
                }
              }),
              { status: 200 }
            );
          }

        if (url.includes("/merchants/")) {
          return new Response(
            JSON.stringify([]),
            { status: 200 }
          );
        }

        throw new Error(
          `Unexpected request: ${url}`
        );
      });

      render(<App />);

      fireEvent.change(
        screen.getByLabelText("Email"),
        {
          target: {
            value: "owner@example.com"
          }
        }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        {
          target: {
            value: "test-password"
          }
        }
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "Sign in"
        })
      );

      await screen.findByText("Merchant Owner");

      fireEvent.click(
        screen.getByRole("button", {
          name: "Billing"
        })
      );

      expect(
        await screen.findByText(
          "Billing Telegram Notifications"
        )
      ).toBeTruthy();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Status: Not connected"
          )
        ).toBeTruthy();
      });

      const statusRequests =
        fetchMock.mock.calls.filter(
          ([input]) =>
            String(input).endsWith(
              "/merchants/merchant-a/billing-telegram"
            )
        );

      expect(statusRequests).toHaveLength(1);

      expect(
        statusRequests[0]?.[1]?.cache
      ).toBe("no-store");

      expect(
        screen.getByRole("button", {
          name: "Generate Telegram Link Token"
        })
      ).toBeTruthy();
    });


    it("allows OWNER to generate and dismiss a billing Telegram link token", async () => {
      const token = "A".repeat(42) + "E";

      const fetchMock = vi.spyOn(
        globalThis,
        "fetch"
      ).mockImplementation(async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return new Response(
            JSON.stringify({
              token: "owner-token",
              user: {
                id: "owner-user",
                merchantId: "merchant-a",
                email: "owner@example.com",
                displayName: "Merchant Owner",
                role: "OWNER"
              }
            }),
            { status: 200 }
          );
        }

        if (url.endsWith("/billing-telegram/link-token")) {
          return new Response(
            JSON.stringify({
              token,
              expiresAt: new Date(
                Date.now() + 60_000
              ).toISOString()
            }),
            { status: 201 }
          );
        }

        if (url.endsWith("/billing-telegram")) {
          return new Response(
            JSON.stringify({
              linked: false,
              destination: null
            }),
            { status: 200 }
          );
        }

        if (url.endsWith("/billing/summary")) {
          return new Response(
            JSON.stringify({
              merchantId: "merchant-a",
              subscription: null,
              currentPeriod: {
                status: "NO_SUBSCRIPTION"
              }
            }),
            { status: 200 }
          );
        }

        if (url.includes("/merchants/")) {
          return new Response(
            JSON.stringify([]),
            { status: 200 }
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      });

      render(<App />);

      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "owner@example.com" }
      });

      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "test-password" }
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Sign in" })
      );

      await screen.findByText("Merchant Owner");

      fireEvent.click(
        screen.getByRole("button", { name: "Billing" })
      );

      await screen.findByText(
        "Billing Telegram Notifications"
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "Generate Telegram Link Token"
        })
      );

      expect(
        await screen.findByText("Temporary linking token:")
      ).toBeTruthy();

      expect(
        screen.getByText((text) =>
          text.includes("/start") &&
          text.includes(token)
        )
      ).toBeTruthy();

      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith(
              "/billing-telegram/link-token"
            ) &&
            init?.method === "POST" &&
            init?.cache === "no-store"
        )
      ).toBe(true);

      fireEvent.click(
        screen.getByRole("button", {
          name: "Dismiss Token"
        })
      );

      expect(
        screen.queryByText("Temporary linking token:")
      ).toBeNull();

      expect(
        screen.queryByText((text) =>
          text.includes("/start") &&
          text.includes(token)
        )
      ).toBeNull();
    });

it.each(["ADMIN", "STAFF"] as const)(
    "does not expose billing Telegram to %s",
    async (role) => {
      const fetchMock = vi.spyOn(
        globalThis,
        "fetch"
      ).mockImplementation(async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return new Response(
            JSON.stringify({
              token: `${role.toLowerCase()}-token`,
              user: {
                id: `${role.toLowerCase()}-user`,
                merchantId: "merchant-a",
                email: `${role.toLowerCase()}@example.com`,
                displayName: `Merchant ${role}`,
                role
              }
            }),
            { status: 200 }
          );
        }

        if (url.includes("/billing-telegram")) {
          throw new Error(
            "Unauthorized billing Telegram request"
          );
        }

        if (url.includes("/merchants/")) {
          return new Response(
            JSON.stringify([]),
            { status: 200 }
          );
        }

        throw new Error(
          `Unexpected request: ${url}`
        );
      });

      render(<App />);

      fireEvent.change(
        screen.getByLabelText("Email"),
        {
          target: {
            value: `${role.toLowerCase()}@example.com`
          }
        }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        {
          target: {
            value: "test-password"
          }
        }
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "Sign in"
        })
      );

      await screen.findByText(`Merchant ${role}`);

      expect(
        screen.queryByRole("button", {
          name: "Billing"
        })
      ).toBeNull();

      expect(
        screen.queryByText(
          "Billing Telegram Notifications"
        )
      ).toBeNull();

      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            String(input).includes(
              "/billing-telegram"
            )
        )
      ).toBe(false);
    }
  );


it("shows connected status without exposing Telegram identifiers", async () => {
    const destination = {
      id: "destination-test-123",
      platformBotId: "platform-bot-test-456",
      maskedTelegramAccount: "••••6789",
      status: "ACTIVE",
      notificationsEnabled: true,
      linkVersion: 1,
      consentedAt: "2026-11-06T10:00:00.000Z",
      createdAt: "2026-11-06T10:00:00.000Z",
      updatedAt: "2026-11-06T10:00:00.000Z"
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return new Response(
            JSON.stringify({
              token: "owner-token",
              user: {
                id: "owner-user",
                merchantId: "merchant-a",
                email: "owner@example.com",
                displayName: "Merchant Owner",
                role: "OWNER"
              }
            }),
            { status: 200 }
          );
        }

        if (
          url.endsWith(
            "/merchants/merchant-a/billing-telegram"
          )
        ) {
          return new Response(
            JSON.stringify({
              linked: true,
              destination
            }),
            { status: 200 }
          );
        }

        if (
          url.endsWith(
            "/merchants/merchant-a/billing/summary"
          )
        ) {
          return new Response(
            JSON.stringify({
              merchantId: "merchant-a",
              subscription: null,
              currentPeriod: {
                status: "NO_SUBSCRIPTION"
              }
            }),
            { status: 200 }
          );
        }

        if (url.includes("/merchants/")) {
          return new Response(
            JSON.stringify([]),
            { status: 200 }
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    const { container } = render(<App />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" }
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password" }
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in" })
    );

    await screen.findByText("Merchant Owner");

    fireEvent.click(
      screen.getByRole("button", { name: "Billing" })
    );

    expect(
      await screen.findByText("Status: Connected")
    ).toBeTruthy();

    expect(
      screen.queryByText("Status: Not connected")
    ).toBeNull();

    const renderedText = container.textContent ?? "";

    expect(renderedText).toContain(
      "Linked Telegram account:"
    );
    expect(renderedText).toContain(
      destination.maskedTelegramAccount
    );

    expect(renderedText).not.toContain("987654321");
    expect(renderedText).not.toContain("123456789");
    expect(renderedText).not.toContain(destination.platformBotId);
    expect(renderedText).not.toContain(destination.id);

    expect(
      screen.getByRole("button", {
        name: "Generate Replacement Telegram Link Token"
      })
    ).toBeTruthy();

    expect(renderedText).toContain(
      "To replace your linked Telegram account"
    );
    expect(renderedText).toContain(
      "Generating a token alone"
    );
    expect(renderedText).toContain(
      "does not replace your current connection."
    );
  });


it("shows a safe error when billing Telegram status fails", async () => {
    const internalError =
      "INTERNAL_DATABASE_CONNECTION_SECRET_DO_NOT_DISPLAY";

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return new Response(
            JSON.stringify({
              token: "owner-token",
              user: {
                id: "owner-user",
                merchantId: "merchant-a",
                email: "owner@example.com",
                displayName: "Merchant Owner",
                role: "OWNER"
              }
            }),
            { status: 200 }
          );
        }

        if (
          url.endsWith(
            "/merchants/merchant-a/billing-telegram"
          )
        ) {
          return new Response(
            JSON.stringify({
              error: internalError
            }),
            { status: 500 }
          );
        }

        if (
          url.endsWith(
            "/merchants/merchant-a/billing/summary"
          )
        ) {
          return new Response(
            JSON.stringify({
              merchantId: "merchant-a",
              subscription: null,
              currentPeriod: {
                status: "NO_SUBSCRIPTION"
              }
            }),
            { status: 200 }
          );
        }

        if (url.includes("/merchants/")) {
          return new Response(
            JSON.stringify([]),
            { status: 200 }
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    const { container } = render(<App />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" }
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password" }
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sign in"
      })
    );

    await screen.findByText("Merchant Owner");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing"
      })
    );

    expect(
      await screen.findByRole("alert")
    ).toHaveProperty(
      "textContent",
      "Unable to load billing Telegram connection status."
    );

    expect(
      container.textContent
    ).not.toContain(internalError);

    expect(
      screen.queryByText("Status: Connected")
    ).toBeNull();

    expect(
      screen.queryByText("Status: Not connected")
    ).toBeNull();
  });


it.each([
    {
      name: "linked without a destination",
      payload: {
        linked: true,
        destination: null
      }
    },
    {
      name: "unlinked with an active destination",
      payload: {
        linked: false,
        destination: {
          id: "destination-1",
          status: "ACTIVE"
        }
      }
    },
    {
      name: "linked with a revoked destination",
      payload: {
        linked: true,
        destination: {
          id: "destination-1",
          status: "REVOKED"
        }
      }
    },
    {
      name: "missing linked flag",
      payload: {
        destination: null
      }
    }
  ])(
    "rejects malformed billing Telegram response: $name",
    async ({ payload }) => {
      vi.spyOn(
        globalThis,
        "fetch"
      ).mockImplementation(async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return new Response(
            JSON.stringify({
              token: "owner-token",
              user: {
                id: "owner-user",
                merchantId: "merchant-a",
                email: "owner@example.com",
                displayName: "Merchant Owner",
                role: "OWNER"
              }
            }),
            { status: 200 }
          );
        }

        if (
          url.endsWith(
            "/merchants/merchant-a/billing-telegram"
          )
        ) {
          return new Response(
            JSON.stringify(payload),
            { status: 200 }
          );
        }

        if (
          url.endsWith(
            "/merchants/merchant-a/billing/summary"
          )
        ) {
          return new Response(
            JSON.stringify({
              merchantId: "merchant-a",
              subscription: null,
              currentPeriod: {
                status: "NO_SUBSCRIPTION"
              }
            }),
            { status: 200 }
          );
        }

        if (url.includes("/merchants/")) {
          return new Response(
            JSON.stringify([]),
            { status: 200 }
          );
        }

        throw new Error(
          `Unexpected request: ${url}`
        );
      });

      render(<App />);

      fireEvent.change(
        screen.getByLabelText("Email"),
        {
          target: {
            value: "owner@example.com"
          }
        }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        {
          target: {
            value: "test-password"
          }
        }
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "Sign in"
        })
      );

      await screen.findByText("Merchant Owner");

      fireEvent.click(
        screen.getByRole("button", {
          name: "Billing"
        })
      );

      const alert = await screen.findByRole("alert");

      expect(alert.textContent).toBe(
        "Unable to load billing Telegram connection status."
      );

      expect(
        screen.queryByText("Status: Connected")
      ).toBeNull();

      expect(
        screen.queryByText("Status: Not connected")
      ).toBeNull();
    }
  );


it("ignores an older billing Telegram response after a newer request succeeds", async () => {
    let resolveOldRequest!: (response: Response) => void;

    const oldRequest = new Promise<Response>((resolve) => {
      resolveOldRequest = resolve;
    });

    let statusRequestCount = 0;

    const fetchMock = vi.spyOn(
      globalThis,
      "fetch"
    ).mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/auth/login")) {
        return new Response(
          JSON.stringify({
            token: "owner-token",
            user: {
              id: "owner-user",
              merchantId: "merchant-a",
              email: "owner@example.com",
              displayName: "Merchant Owner",
              role: "OWNER"
            }
          }),
          { status: 200 }
        );
      }

      if (
        url.endsWith(
          "/merchants/merchant-a/billing-telegram"
        )
      ) {
        statusRequestCount++;

        if (statusRequestCount === 1) {
          return oldRequest;
        }

        return new Response(
          JSON.stringify({
            linked: false,
            destination: null
          }),
          { status: 200 }
        );
      }

      if (
        url.endsWith(
          "/merchants/merchant-a/billing/summary"
        )
      ) {
        return new Response(
          JSON.stringify({
            merchantId: "merchant-a",
            subscription: null,
            currentPeriod: {
              status: "NO_SUBSCRIPTION"
            }
          }),
          { status: 200 }
        );
      }

      if (url.includes("/merchants/")) {
        return new Response(
          JSON.stringify([]),
          { status: 200 }
        );
      }

      throw new Error(
        `Unexpected request: ${url}`
      );
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" }
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password" }
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sign in"
      })
    );

    await screen.findByText("Merchant Owner");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing"
      })
    );

    await waitFor(() => {
      expect(statusRequestCount).toBe(1);
    });

    expect(
      screen.getByText("Checking Telegram connection...")
    ).toBeTruthy();

    // Reopen Billing to start a newer status request.
    fireEvent.click(
        screen.getByRole("button", {
          name: "Inventory"
        })
      );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing"
      })
    );

    await waitFor(() => {
      expect(statusRequestCount).toBe(2);
      expect(
        screen.getByText("Status: Not connected")
      ).toBeTruthy();
    });

    // The older request now returns a server error.
    // It must not overwrite the newer successful result.
    resolveOldRequest(
      new Response(
        JSON.stringify({
          error: "STALE_INTERNAL_ERROR"
        }),
        { status: 500 }
      )
    );

    await waitFor(() => {
      expect(
        screen.getByText("Status: Not connected")
      ).toBeTruthy();

      expect(
        screen.queryByText(
          "Unable to load billing Telegram connection status."
        )
      ).toBeNull();
    });

    const statusRequests = fetchMock.mock.calls.filter(
      ([input]) =>
        String(input).endsWith(
          "/merchants/merchant-a/billing-telegram"
        )
    );

    expect(statusRequests).toHaveLength(2);
  });


it("ignores a delayed billing Telegram response after logout", async () => {
    let resolveStatusRequest!: (response: Response) => void;

    const pendingStatusRequest = new Promise<Response>(
      (resolve) => {
        resolveStatusRequest = resolve;
      }
    );

    let statusRequestStarted = false;

    vi.spyOn(
      globalThis,
      "fetch"
    ).mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/auth/login")) {
        return new Response(
          JSON.stringify({
            token: "owner-token",
            user: {
              id: "owner-user",
              merchantId: "merchant-a",
              email: "owner@example.com",
              displayName: "Merchant Owner",
              role: "OWNER"
            }
          }),
          { status: 200 }
        );
      }

      if (
        url.endsWith(
          "/merchants/merchant-a/billing-telegram"
        )
      ) {
        statusRequestStarted = true;
        return pendingStatusRequest;
      }

      if (
        url.endsWith(
          "/merchants/merchant-a/billing/summary"
        )
      ) {
        return new Response(
          JSON.stringify({
            merchantId: "merchant-a",
            subscription: null,
            currentPeriod: {
              status: "NO_SUBSCRIPTION"
            }
          }),
          { status: 200 }
        );
      }

      if (url.includes("/merchants/")) {
        return new Response(
          JSON.stringify([]),
          { status: 200 }
        );
      }

      throw new Error(
        `Unexpected request: ${url}`
      );
    });

    const { container } = render(<App />);

    fireEvent.change(
      screen.getByLabelText("Email"),
      {
        target: {
          value: "owner@example.com"
        }
      }
    );

    fireEvent.change(
      screen.getByLabelText("Password"),
      {
        target: {
          value: "test-password"
        }
      }
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sign in"
      })
    );

    await screen.findByText("Merchant Owner");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing"
      })
    );

    await waitFor(() => {
      expect(statusRequestStarted).toBe(true);
    });

    expect(
      screen.getByText(
        "Checking Telegram connection..."
      )
    ).toBeTruthy();

    // Invalidate the OWNER session while the request
    // is still pending.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Sign out"
      })
    );

    await screen.findByRole("button", {
      name: "Sign in"
    });

    // Resolve the old OWNER request after logout.
    resolveStatusRequest(
      new Response(
        JSON.stringify({
          linked: true,
          destination: {
            id: "old-owner-destination",
            platformBotId: "old-platform-bot",
            chatId: "987654321",
            telegramUserId: "123456789",
            status: "ACTIVE",
            linkVersion: 1,
            consentedAt: "2026-11-06T10:00:00.000Z",
            createdAt: "2026-11-06T10:00:00.000Z",
            updatedAt: "2026-11-06T10:00:00.000Z"
          }
        }),
        { status: 200 }
      )
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Sign in"
        })
      ).toBeTruthy();

      expect(
        screen.queryByText("Status: Connected")
      ).toBeNull();

      expect(
        screen.queryByText(
          "Billing Telegram Notifications"
        )
      ).toBeNull();
    });

    expect(container.textContent).not.toContain(
      "old-owner-destination"
    );

    expect(container.textContent).not.toContain(
      "987654321"
    );

    expect(container.textContent).not.toContain(
      "123456789"
    );
  });

  });
