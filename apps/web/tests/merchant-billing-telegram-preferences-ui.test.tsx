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

type PreferenceScenario = {
  initialEnabled?: boolean;
  patchStatus?: number;
  patchBody?: unknown;
  refreshedEnabled?: boolean;
  refreshFails?: boolean;
};

function setupScenario({
  initialEnabled = true,
  patchStatus = 200,
  patchBody,
  refreshedEnabled,
  refreshFails = false
}: PreferenceScenario = {}) {
  let savedEnabled = initialEnabled;
  let statusRequests = 0;

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
        "/merchants/merchant-a/billing-telegram/preferences"
      )
    ) {
      expect(init?.method).toBe("PATCH");
      expect(init?.cache).toBe("no-store");

      const request = JSON.parse(
        String(init?.body)
      ) as { notificationsEnabled: boolean };

      if (patchStatus === 200) {
        savedEnabled = request.notificationsEnabled;
      }

      return new Response(
        JSON.stringify(
          patchBody ?? {
            notificationsEnabled:
              request.notificationsEnabled,
            suppressedDeliveries: 0
          }
        ),
        { status: patchStatus }
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
          linked: true,
          destination: {
            id: "destination-test",
            platformBotId: "platform-bot",
            maskedTelegramAccount: "••••6789",
            status: "ACTIVE",
            linkVersion: 1,
            notificationsEnabled:
              statusRequests > 1 &&
              refreshedEnabled !== undefined
                ? refreshedEnabled
                : savedEnabled,
            consentedAt: "2026-11-06T10:00:00.000Z",
            createdAt: "2026-11-06T10:00:00.000Z",
            updatedAt: "2026-11-06T10:00:00.000Z"
          }
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
    setSavedEnabled: (value: boolean) => {
      savedEnabled = value;
    }
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

describe("billing Telegram preference controls", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("allows OWNER to disable notifications", async () => {
    const { fetchMock } = setupScenario();

    await openBilling();

    expect(
      screen.getByText("Notifications: Enabled")
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disable notifications"
      })
    );

    await screen.findByText(
      "Notification preference updated and status refreshed."
    );

    expect(
      screen.getByText("Notifications: Disabled")
    ).toBeTruthy();

    const patchCall = fetchMock.mock.calls.find(
      ([input]) =>
        String(input).endsWith(
          "/billing-telegram/preferences"
        )
    );

    expect(patchCall).toBeDefined();
    expect(
      JSON.parse(String(patchCall?.[1]?.body))
    ).toEqual({
      notificationsEnabled: false
    });
  });

  it("allows OWNER to enable notifications", async () => {
    setupScenario({ initialEnabled: false });

    await openBilling();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Enable notifications"
      })
    );

    await screen.findByText(
      "Notification preference updated and status refreshed."
    );

    expect(
      screen.getByText("Notifications: Enabled")
    ).toBeTruthy();
  });

  it("shows safety conflict without changing preference", async () => {
    setupScenario({ patchStatus: 409 });

    await openBilling();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disable notifications"
      })
    );

    await screen.findByText(
      "Notifications cannot be changed while deliveries require safety review."
    );

    expect(
      screen.getByText("Notifications: Enabled")
    ).toBeTruthy();
  });

  it("rejects malformed PATCH success", async () => {
    setupScenario({
      patchBody: {
        notificationsEnabled: "false",
        suppressedDeliveries: 0
      }
    });

    await openBilling();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disable notifications"
      })
    );

    await screen.findByText(
      "Unable to confirm the preference update. Refresh Telegram status before trying again."
    );

    expect(
      screen.queryByText(
        "Notification preference updated and status refreshed."
      )
    ).toBeNull();
  });

  it("does not confirm a failed status refresh", async () => {
    setupScenario({ refreshFails: true });

    await openBilling();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disable notifications"
      })
    );

    await screen.findByText(
      "Preference update submitted, but the saved notification status could not be confirmed."
    );

    expect(
      screen.queryByText(
        "Notification preference updated and status refreshed."
      )
    ).toBeNull();
  });

  it("does not confirm a mismatched saved preference", async () => {
    setupScenario({
      refreshedEnabled: true
    });

    await openBilling();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disable notifications"
      })
    );

    await screen.findByText(
      "Preference update submitted, but the saved notification status could not be confirmed."
    );

    expect(
      screen.getByText("Notifications: Enabled")
    ).toBeTruthy();
  });
  it("ignores a delayed preference response after logout", async () => {
    let resolvePatch!: (response: Response) => void;

    const pendingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    const { fetchMock } = setupScenario();

    const originalImplementation =
      fetchMock.getMockImplementation();

    fetchMock.mockImplementation(async (input, init) => {
      if (
        String(input).endsWith(
          "/billing-telegram/preferences"
        )
      ) {
        return pendingPatch;
      }

      if (!originalImplementation) {
        throw new Error("Missing fetch mock");
      }

      return originalImplementation(input, init);
    });

    await openBilling();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disable notifications"
      })
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            String(input).endsWith(
              "/billing-telegram/preferences"
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

    resolvePatch(
      new Response(
        JSON.stringify({
          notificationsEnabled: false,
          suppressedDeliveries: 0
        }),
        { status: 200 }
      )
    );

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Notification preference updated and status refreshed."
        )
      ).toBeNull();

      expect(
        screen.queryByText(
          "Billing Telegram Notifications"
        )
      ).toBeNull();
    });
  });

  it("blocks a separate status refresh while PATCH is pending", async () => {
    let resolvePatch!: (response: Response) => void;

    const pendingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    const { fetchMock, setSavedEnabled } = setupScenario();
    const originalImplementation =
      fetchMock.getMockImplementation();

    fetchMock.mockImplementation(async (input, init) => {
      if (
        String(input).endsWith(
          "/billing-telegram/preferences"
        )
      ) {
        return pendingPatch;
      }

      if (!originalImplementation) {
        throw new Error("Missing fetch mock");
      }

      return originalImplementation(input, init);
    });

    await openBilling();

    const countStatusRequests = () =>
      fetchMock.mock.calls.filter(
        ([input]) =>
          String(input).endsWith(
            "/merchants/merchant-a/billing-telegram"
          )
      ).length;

    expect(countStatusRequests()).toBe(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disable notifications"
      })
    );

    await screen.findByRole("button", {
      name: "Saving notification preference..."
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Billing"
      })
    );

    expect(countStatusRequests()).toBe(1);

    expect(
      (
        screen.getByRole("button", {
          name: "Refresh Telegram Status"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    setSavedEnabled(false);

    resolvePatch(
      new Response(
        JSON.stringify({
          notificationsEnabled: false,
          suppressedDeliveries: 0
        }),
        { status: 200 }
      )
    );

    await waitFor(() => {
      expect(countStatusRequests()).toBe(2);

      expect(
        screen.getByText("Notifications: Disabled")
      ).toBeTruthy();
    });
  });

});