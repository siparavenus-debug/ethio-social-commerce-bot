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

type Role = "OWNER" | "ADMIN" | "STAFF";

function mockPlatform(role: Role) {
  const requests: string[] = [];

  const fetchMock = vi.spyOn(
    globalThis,
    "fetch"
  ).mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push(url);

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
            role
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
      url.includes(
        "/platform/billing/telegram/deliveries?"
      )
    ) {
      expect(
        new Headers(init?.headers).get("Authorization")
      ).toBe("Bearer platform-token");

      expect(init?.method ?? "GET").toBe("GET");

      return new Response(
        JSON.stringify({
          deliveries: [{
            id: "delivery-1",
            merchantId: "merchant-1",
            notificationId: "notification-1",
            eventId: "event-1",
            notificationStatus: "REVIEW_REQUIRED",
            status: "REVIEW_REQUIRED",
            attemptCount: 1,
            nextAttemptAt: null,
            processingUntil: null,
            createdAt: "2026-11-16T08:00:00.000Z",
            updatedAt: "2026-11-16T08:01:00.000Z",
            quarantined: true,
            quarantineCreatedAt: "2026-11-16T08:01:00.000Z",
            attempts: [{
              id: "attempt-1",
              attemptNumber: 1,
              outcome: "UNCERTAIN",
              requestStartedAt: "2026-11-16T08:00:00.000Z",
              responseReceivedAt: null,
              createdAt: "2026-11-16T08:00:00.000Z"
            }]
          }],
          nextCursor: null
        }),
        { status: 200 }
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  return { requests, fetchMock };
}

async function signIn() {
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
}

describe("platform billing Telegram deliveries interactions", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  for (const role of ["OWNER", "ADMIN"] as const) {
    it(`allows ${role} to inspect read-only deliveries`, async () => {
      const { requests } = mockPlatform(role);

      await signIn();

      fireEvent.click(
        screen.getByRole("button", {
          name: "Billing Telegram Deliveries"
        })
      );

      await waitFor(() => {
        expect(
          requests.some(url =>
            url.includes(
              "/platform/billing/telegram/deliveries?"
            )
          )
        ).toBe(true);
      });

      expect(
        await screen.findByText("merchant-1")
      ).toBeTruthy();

      expect(
        screen.getByText(/#1: UNCERTAIN/)
      ).toBeTruthy();

      expect(
        screen.getByText(/not confirmed human receipt/)
      ).toBeTruthy();

      expect(
        (
          screen.getByLabelText(
            "Billing Telegram delivery status"
          ) as HTMLSelectElement
        ).value
      ).toBe("REVIEW_REQUIRED");
    });
  }

  it("applies billing delivery filters", async () => {
    const { requests } = mockPlatform("ADMIN");

    await signIn();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing Telegram Deliveries"
      })
    );

    await screen.findByText("merchant-1");

    fireEvent.change(
      screen.getByLabelText(
        "Billing Telegram delivery status"
      ),
      { target: { value: "FAILED" } }
    );

    await waitFor(() => {
      expect(
        requests.some(url => {
          if (!url.includes("/platform/billing/telegram/deliveries?")) {
            return false;
          }

          const params = new URL(url).searchParams;
          return params.get("status") === "FAILED";
        })
      ).toBe(true);
    });

    fireEvent.change(
      screen.getByLabelText(
        "Billing Telegram merchant ID"
      ),
      { target: { value: "merchant-1" } }
    );

    await waitFor(() => {
      expect(
        requests.some(url => {
          if (!url.includes("/platform/billing/telegram/deliveries?")) {
            return false;
          }

          const params = new URL(url).searchParams;

          return (
            params.get("status") === "FAILED" &&
            params.get("merchantId") === "merchant-1" &&
            params.get("limit") === "50" &&
            !params.has("cursor")
          );
        })
      ).toBe(true);
    });
  });

  it("uses server-issued cursors for pagination", async () => {
    const { requests, fetchMock } = mockPlatform("ADMIN");

    const originalImplementation =
      fetchMock.getMockImplementation();

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (
        url.includes(
          "/platform/billing/telegram/deliveries?"
        )
      ) {
        requests.push(url);

        const params = new URL(url).searchParams;

        return new Response(
          JSON.stringify({
            deliveries: [],
            nextCursor: params.has("cursor")
              ? null
              : "cursor-page-2"
          }),
          { status: 200 }
        );
      }

      if (!originalImplementation) {
        throw new Error("Missing original fetch mock");
      }

      return originalImplementation(input, init);
    });

    await signIn();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing Telegram Deliveries"
      })
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Next page"
        }).hasAttribute("disabled")
      ).toBe(false);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Next page"
      })
    );

    await waitFor(() => {
      expect(
        requests.some(url => {
          if (!url.includes("/platform/billing/telegram/deliveries?")) {
            return false;
          }

          return (
            new URL(url).searchParams.get("cursor") ===
            "cursor-page-2"
          );
        })
      ).toBe(true);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "First page"
        }).hasAttribute("disabled")
      ).toBe(false);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "First page"
      })
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "First page"
        }).hasAttribute("disabled")
      ).toBe(true);
    });
  });
  it("does not render sensitive Telegram delivery fields", async () => {
    const { fetchMock } = mockPlatform("ADMIN");
    const original = fetchMock.getMockImplementation();

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("/platform/billing/telegram/deliveries?")) {
        return new Response(
          JSON.stringify({
            deliveries: [{
              id: "delivery-private",
              merchantId: "merchant-private",
              notificationId: "notification-private",
              eventId: "event-private",
              notificationStatus: "REVIEW_REQUIRED",
              status: "REVIEW_REQUIRED",
              attemptCount: 1,
              nextAttemptAt: null,
              processingUntil: null,
              createdAt: "2026-11-16T08:00:00.000Z",
              updatedAt: "2026-11-16T08:01:00.000Z",
              quarantined: true,
              quarantineCreatedAt: null,
              telegramMessageId: "SECRET_MESSAGE_ID_123",
              chatId: "SECRET_CHAT_ID_456",
              botToken: "SECRET_BOT_TOKEN_789",
              sanitizedError: "SECRET_ERROR_DETAIL",
              terminalReason: "SECRET_TERMINAL_REASON",
              quarantineReason: "SECRET_QUARANTINE_REASON",
              attempts: [{
                id: "attempt-private",
                attemptNumber: 1,
                outcome: "UNCERTAIN",
                requestStartedAt: null,
                responseReceivedAt: null,
                createdAt: "2026-11-16T08:00:00.000Z",
                telegramMessageId: "SECRET_ATTEMPT_MESSAGE"
              }]
            }],
            nextCursor: null
          }),
          { status: 200 }
        );
      }

      if (!original) {
        throw new Error("Missing original fetch mock");
      }

      return original(input, init);
    });

    await signIn();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing Telegram Deliveries"
      })
    );

    await screen.findByText("merchant-private");

    for (const secret of [
      "SECRET_MESSAGE_ID_123",
      "SECRET_CHAT_ID_456",
      "SECRET_BOT_TOKEN_789",
      "SECRET_ERROR_DETAIL",
      "SECRET_TERMINAL_REASON",
      "SECRET_QUARANTINE_REASON",
      "SECRET_ATTEMPT_MESSAGE"
    ]) {
      expect(
        document.body.textContent?.includes(secret)
      ).toBe(false);
    }
  });

  it("clears billing delivery records after logout", async () => {
    mockPlatform("ADMIN");

    await signIn();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing Telegram Deliveries"
      })
    );

    await screen.findByText("merchant-1");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sign out"
      })
    );

    await waitFor(() => {
      expect(
        screen.queryByText("merchant-1")
      ).toBeNull();
    });

    expect(
      screen.queryByRole("button", {
        name: "Billing Telegram Deliveries"
      })
    ).toBeNull();
  });
  it("does not expose billing delivery navigation to STAFF", async () => {
    const { requests } = mockPlatform("STAFF");

    await signIn();

    expect(
      screen.queryByRole("button", {
        name: "Billing Telegram Deliveries"
      })
    ).toBeNull();

    expect(
      requests.some(url =>
        url.includes(
          "/platform/billing/telegram/deliveries?"
        )
      )
    ).toBe(false);
  });
});