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

type Scenario = {
  unlinkStatus?: number;
  unlinkBody?: unknown;
  refreshFails?: boolean;
  remainsLinked?: boolean;
};

function setupScenario({
  unlinkStatus = 200,
  unlinkBody,
  refreshFails = false,
  remainsLinked = false
}: Scenario = {}) {
  let linked = true;
  let statusRequests = 0;
  let unlinkRequests = 0;

  const fetchMock = vi.spyOn(
    globalThis,
    "fetch"
  ).mockImplementation(async (input, init) => {
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
        "/merchants/merchant-a/billing-telegram/unlink"
      )
    ) {
      expect(init?.method).toBe("POST");
      expect(init?.cache).toBe("no-store");

      unlinkRequests += 1;

      if (unlinkStatus === 200 && !remainsLinked) {
        linked = false;
      }

      return new Response(
        JSON.stringify(
          unlinkBody ?? {
            linked: false,
            unlinked: true
          }
        ),
        { status: unlinkStatus }
      );
    }

    if (
      url.endsWith(
        "/merchants/merchant-a/billing-telegram"
      )
    ) {
      statusRequests += 1;

      if (refreshFails && statusRequests > 1) {
        return new Response(
          JSON.stringify({ error: "Unavailable" }),
          { status: 500 }
        );
      }

      return new Response(
        JSON.stringify({
          linked,
          destination: linked
            ? {
                id: "destination-test",
                platformBotId: "platform-bot",
                maskedTelegramAccount: "****6789",
                status: "ACTIVE",
                linkVersion: 1,
                notificationsEnabled: true,
                consentedAt: "2026-11-06T10:00:00.000Z",
                createdAt: "2026-11-06T10:00:00.000Z",
                updatedAt: "2026-11-06T10:00:00.000Z"
              }
            : null
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

  return {
    fetchMock,
    getUnlinkRequests: () => unlinkRequests,
    getStatusRequests: () => statusRequests
  };
}

async function openBilling() {
  render(<App />);

  fireEvent.change(
    screen.getByLabelText("Email"),
    { target: { value: "owner@example.com" } }
  );

  fireEvent.change(
    screen.getByLabelText("Password"),
    { target: { value: "test-password" } }
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

  await screen.findByText("Status: Connected");
}

function openConfirmation() {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Unlink Telegram Account"
    })
  );
}

function confirmUnlink() {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Confirm Unlink"
    })
  );
}

describe("billing Telegram OWNER unlink controls", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("requires explicit confirmation", async () => {
    const scenario = setupScenario();

    await openBilling();
    openConfirmation();

    expect(
      screen.getByRole("button", {
        name: "Confirm Unlink"
      })
    ).toBeTruthy();

    expect(scenario.getUnlinkRequests()).toBe(0);
  });

  it("allows cancellation without unlinking", async () => {
    const scenario = setupScenario();

    await openBilling();
    openConfirmation();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Cancel"
      })
    );

    expect(scenario.getUnlinkRequests()).toBe(0);

    expect(
      screen.getByText("Status: Connected")
    ).toBeTruthy();
  });

  it("verifies disconnection with authoritative GET", async () => {
    const scenario = setupScenario();

    await openBilling();
    openConfirmation();
    confirmUnlink();

    await screen.findByText(
      "Telegram account disconnected and status verified."
    );

    expect(
      screen.getByText("Status: Not connected")
    ).toBeTruthy();

    expect(scenario.getUnlinkRequests()).toBe(1);
    expect(scenario.getStatusRequests()).toBe(2);
  });

  it("preserves connection on HTTP 409", async () => {
    const scenario = setupScenario({
      unlinkStatus: 409
    });

    await openBilling();
    openConfirmation();
    confirmUnlink();

    await screen.findByText(
      /deliveries require safety review/
    );

    expect(
      screen.getByText("Status: Connected")
    ).toBeTruthy();

    expect(scenario.getUnlinkRequests()).toBe(1);

    expect(
      screen.queryByText(
        "Telegram account disconnected and status verified."
      )
    ).toBeNull();
  });

  it("rejects malformed unlink success", async () => {
    setupScenario({
      unlinkBody: {
        linked: false,
        unlinked: "yes"
      }
    });

    await openBilling();
    openConfirmation();
    confirmUnlink();

    await screen.findByText(
      /Unable to confirm Telegram disconnection/
    );

    expect(
      screen.queryByText(
        "Telegram account disconnected and status verified."
      )
    ).toBeNull();
  });

  it("does not confirm a failed status refresh", async () => {
    setupScenario({
      refreshFails: true
    });

    await openBilling();
    openConfirmation();
    confirmUnlink();

    await screen.findByText(
      /disconnected status could not be confirmed/
    );

    expect(
      screen.queryByText(
        "Telegram account disconnected and status verified."
      )
    ).toBeNull();
  });

  it("does not confirm when destination remains linked", async () => {
    setupScenario({
      remainsLinked: true
    });

    await openBilling();
    openConfirmation();
    confirmUnlink();

    await screen.findByText(
      /disconnected status could not be confirmed/
    );

    expect(
      screen.getByText("Status: Connected")
    ).toBeTruthy();
  });

  it("ignores an unlink response after logout", async () => {
    let resolveUnlink!: (response: Response) => void;

    const pendingUnlink = new Promise<Response>((resolve) => {
      resolveUnlink = resolve;
    });

    const { fetchMock } = setupScenario();
    const original = fetchMock.getMockImplementation();

    fetchMock.mockImplementation(async (input, init) => {
      if (
        String(input).endsWith(
          "/billing-telegram/unlink"
        )
      ) {
        return pendingUnlink;
      }

      if (!original) {
        throw new Error("Missing fetch mock");
      }

      return original(input, init);
    });

    await openBilling();
    openConfirmation();
    confirmUnlink();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            String(input).endsWith(
              "/billing-telegram/unlink"
            )
        )
      ).toBe(true);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sign out"
      })
    );

    await screen.findByRole("button", {
      name: "Sign in"
    });

    resolveUnlink(
      new Response(
        JSON.stringify({
          linked: false,
          unlinked: true
        }),
        { status: 200 }
      )
    );

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Telegram account disconnected and status verified."
        )
      ).toBeNull();

      expect(
        screen.queryByText(
          "Billing Telegram Notifications"
        )
      ).toBeNull();
    });
  });

  it("blocks refresh and preference changes during unlink", async () => {
    let resolveUnlink!: (response: Response) => void;

    const pendingUnlink = new Promise<Response>((resolve) => {
      resolveUnlink = resolve;
    });

    const { fetchMock } = setupScenario();
    const original = fetchMock.getMockImplementation();

    fetchMock.mockImplementation(async (input, init) => {
      if (
        String(input).endsWith(
          "/billing-telegram/unlink"
        )
      ) {
        return pendingUnlink;
      }

      if (!original) {
        throw new Error("Missing fetch mock");
      }

      return original(input, init);
    });

    await openBilling();
    openConfirmation();
    confirmUnlink();

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Refresh Telegram Status"
        }).hasAttribute("disabled")
      ).toBe(true);
    });

    expect(
      screen.getByRole("button", {
        name: "Disable notifications"
      }).hasAttribute("disabled")
    ).toBe(true);

    resolveUnlink(
      new Response(
        JSON.stringify({
          linked: false,
          unlinked: true
        }),
        { status: 200 }
      )
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input]) =>
            String(input).endsWith(
              "/billing-telegram/unlink"
            )
        ).length
      ).toBe(1);
    });
  });
});
