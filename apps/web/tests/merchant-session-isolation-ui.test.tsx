// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App.js";
import * as sessionGuardModule from "../src/session-guard.js";

const merchantAPaymentReview = {
  id: "payment-a",
  merchantId: "merchant-a",
  orderId: "order-a",
  provider: "Telebirr",
  status: "REVIEW_REQUIRED",
  amount: "500.00",
  currency: "ETB",
  transactionReference: "TEST-REF-A",
  receiptUrl: null,
  receiptMetadata: null,
  reviewNote: null,
  createdAt: "2026-10-23T08:00:00.000Z",
  order: {
    orderNumber: "ORDER-A-001",
    status: "PAYMENT_REVIEW",
    total: "500.00",
    customer: {
      name: "Test Customer A",
      phone: null,
      telegramChatId: null
    },
    items: [{
      productName: "Test Product",
      quantity: 1,
      unitPrice: "500.00",
      lineTotal: "500.00"
    }]
  }
};
describe("merchant session isolation UI", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders the merchant login form without a stored session", () => {
    render(<App />);

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Sign in" })
    ).toBeTruthy();

    expect(
      screen.queryByRole("button", { name: "Sign out" })
    ).toBeNull();
  });


it("keeps Merchant B signed in when Merchant A receives a delayed 401", async () => {
  let resolveOldRequest!: (response: Response) => void;

  const oldRequest = new Promise<Response>((resolve) => {
    resolveOldRequest = resolve;
  });

  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input, init) => {
      const url = String(input);

      if (url.endsWith("/auth/login")) {
        const body = JSON.parse(String(init?.body));
        const isA = body.email === "a@example.com";

        return new Response(JSON.stringify({
          token: isA ? "token-a" : "token-b",
          user: {
            id: isA ? "user-a" : "user-b",
            merchantId: isA ? "merchant-a" : "merchant-b",
            email: body.email,
            displayName: isA ? "Merchant A" : "Merchant B",
            role: "STAFF"
          }
        }), { status: 200 });
      }

      if (url.includes("/merchants/merchant-a/orders")) {
        return oldRequest;
      }

      if (url.includes("/merchants/")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      throw new Error(`Unexpected request: ${url}`);
    }
  );

  render(<App />);

  async function signIn(email: string) {
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: email }
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText(`Merchant ${email.startsWith("a") ? "A" : "B"}`)).toBeTruthy();
    });
  }

  await signIn("a@example.com");

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/merchants/merchant-a/orders")
      )
    ).toBe(true);
  });

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  await signIn("b@example.com");

  await act(async () => {
    resolveOldRequest(new Response(
      JSON.stringify({ error: "Session expired" }),
      { status: 401 }
    ));

    await oldRequest;
  });

  await waitFor(() => {
    expect(screen.getByText("Merchant B")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(
      screen.queryByText(/Your session has expired/)
    ).toBeNull();
  });
});
  it("ignores payment verification after the session is invalidated", async () => {
    let resolveVerificationJson!: (value: unknown) => void;
    let verificationJsonStarted = false;

    const verificationJson = new Promise<unknown>((resolve) => {
      resolveVerificationJson = resolve;
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          const body = JSON.parse(String(init?.body));
          const isA = body.email === "a@example.com";

          return new Response(JSON.stringify({
            token: isA ? "token-a" : "token-b",
            user: {
              id: isA ? "user-a" : "user-b",
              merchantId: isA ? "merchant-a" : "merchant-b",
              email: body.email,
              displayName: isA ? "Merchant A" : "Merchant B",
              role: "OWNER"
            }
          }), { status: 200 });
        }

        if (
          url.includes("/merchants/merchant-a/payment-review/payment-a/verify")
        ) {
          const response = new Response("{}", { status: 200 });
          response.json = async () => {
            verificationJsonStarted = true;
            return verificationJson;
          };
          return response;
        }

        if (
          url.endsWith("/merchants/merchant-a/payment-review")
        ) {
          return new Response(
            JSON.stringify([merchantAPaymentReview]),
            { status: 200 }
          );
        }

        if (url.includes("/merchants/")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    let activeSessionGuard:
      ReturnType<typeof sessionGuardModule.createSessionGuard> | undefined;

    const originalCreateSessionGuard =
      sessionGuardModule.createSessionGuard;

    vi.spyOn(sessionGuardModule, "createSessionGuard")
      .mockImplementation(() => {
        const guard = originalCreateSessionGuard();
        activeSessionGuard ??= guard;
        return guard;
      });
    render(<App />);

    expect(activeSessionGuard).toBeDefined();

    async function signIn(email: string) {
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: email }
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "test-password" }
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(
          screen.getByText(email.startsWith("a") ? "Merchant A" : "Merchant B")
        ).toBeTruthy();
      });
    }

    await signIn("a@example.com");

    const verifyButton = await screen.findByRole("button", {
      name: "Verify Payment"
    });

    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(verificationJsonStarted).toBe(true);
    });

    activeSessionGuard!.invalidate();

    await act(async () => {
      resolveVerificationJson({
        order: { orderNumber: "ORDER-A-001" }
      });
      await verificationJson;
    });

    await waitFor(() => {

      expect(
        screen.queryByText(/Payment verified\. Order ORDER-A-001/)
      ).toBeNull();
    });

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/merchant-a/payment-review/payment-a/verify")
      )
    ).toBe(true);
  });

  it("ignores a successful password change after session invalidation", async () => {
    let resolvePasswordResponse!: (response: Response) => void;

    const passwordResponse = new Promise<Response>((resolve) => {
      resolvePasswordResponse = resolve;
    });

    let passwordRequestStarted = false;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return new Response(JSON.stringify({
            token: "token-a",
            user: {
              id: "user-a",
              merchantId: "merchant-a",
              email: "a@example.com",
              displayName: "Merchant A",
              role: "STAFF"
            }
          }), { status: 200 });
        }

        if (url.endsWith("/auth/password")) {
          expect(init?.method).toBe("PATCH");
          passwordRequestStarted = true;
          return passwordResponse;
        }

        if (url.includes("/merchants/")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    let activeSessionGuard:
      ReturnType<typeof sessionGuardModule.createSessionGuard> | undefined;

    const originalCreateSessionGuard =
      sessionGuardModule.createSessionGuard;

    vi.spyOn(sessionGuardModule, "createSessionGuard")
      .mockImplementation(() => {
        const guard = originalCreateSessionGuard();
        activeSessionGuard ??= guard;
        return guard;
      });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@example.com" }
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password" }
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in" })
    );

    await screen.findByText("Merchant A");

    fireEvent.click(
      screen.getByRole("button", { name: "Change password" })
    );

    const dialog = screen.getByRole("dialog", {
      name: "Change password"
    });

    fireEvent.change(
      screen.getByLabelText("Current password"),
      { target: { value: "old-password" } }
    );

    fireEvent.change(
      screen.getByLabelText("New password", { exact: true }),
      { target: { value: "new-password-123" } }
    );

    fireEvent.change(
      screen.getByLabelText("Confirm new password"),
      { target: { value: "new-password-123" } }
    );

    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() => {
      expect(passwordRequestStarted).toBe(true);
    });

    expect(activeSessionGuard).toBeDefined();

    activeSessionGuard!.invalidate();

    await act(async () => {
      resolvePasswordResponse(
        new Response(JSON.stringify({ success: true }), {
          status: 200
        })
      );

      await passwordResponse;
    });

    expect(screen.getByText("Merchant A")).toBeTruthy();

    expect(
      screen.getByRole("button", { name: "Sign out" })
    ).toBeTruthy();

    expect(
      screen.queryByLabelText("Email")
    ).toBeNull();

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/auth/password")
      )
    ).toBe(true);
  });

  it("closes settlement evidence after session invalidation", async () => {
    let resolveEvidenceResponse!: (response: Response) => void;

    const evidenceResponse = new Promise<Response>((resolve) => {
      resolveEvidenceResponse = resolve;
    });

    let evidenceRequestStarted = false;

    const evidenceWindow = {
      opener: null as unknown,
      location: { href: "" },
      close: vi.fn()
    };

    const openMock = vi.spyOn(window, "open").mockImplementation(
      () => evidenceWindow as unknown as Window
    );

    const createObjectURLMock = vi.spyOn(
      URL,
      "createObjectURL"
    ).mockImplementation(() => "blob:test-evidence");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return new Response(JSON.stringify({
            token: "token-a",
            user: {
              id: "user-a",
              merchantId: "merchant-a",
              email: "a@example.com",
              displayName: "Merchant A",
              role: "OWNER"
            }
          }), { status: 200 });
        }

        if (url.endsWith("/billing/summary")) {
          return new Response(JSON.stringify({
            currentPeriod: {
              status: "ACTIVE"
            },
            subscription: null
          }), { status: 200 });
        }

        if (url.endsWith("/billing/commissions")) {
          return new Response(JSON.stringify({
            commissions: []
          }), { status: 200 });
        }

        if (url.endsWith("/billing/invoices")) {
          return new Response(JSON.stringify({
            invoices: []
          }), { status: 200 });
        }

        if (url.endsWith("/billing/settlements")) {
          return new Response(JSON.stringify({
            settlements: [{
              id: "settlement-a",
              provider: "Telebirr",
              status: "SUBMITTED",
              amount: "500.00",
              currency: "ETB",
              transactionReference: "SETTLEMENT-A",
              receiptUrl: null,
              hasReceiptEvidence: true,
              reviewNote: null,
              submittedAt: "2026-10-23T08:00:00.000Z",
              verifiedAt: null
            }]
          }), { status: 200 });
        }

        if (
          url.endsWith(
            "/billing/settlements/settlement-a/evidence"
          )
        ) {
          evidenceRequestStarted = true;
          return evidenceResponse;
        }

        if (url.includes("/merchants/")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    let activeSessionGuard:
      ReturnType<typeof sessionGuardModule.createSessionGuard> | undefined;

    const originalCreateSessionGuard =
      sessionGuardModule.createSessionGuard;

    vi.spyOn(sessionGuardModule, "createSessionGuard")
      .mockImplementation(() => {
        const guard = originalCreateSessionGuard();
        activeSessionGuard ??= guard;
        return guard;
      });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@example.com" }
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password" }
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in" })
    );

    await screen.findByText("Merchant A");

    fireEvent.click(
      screen.getByRole("button", { name: "Billing" })
    );

    const evidenceButton = await screen.findByRole(
      "button",
      { name: "View settlement evidence" }
    );

    fireEvent.click(evidenceButton);

    await waitFor(() => {
      expect(evidenceRequestStarted).toBe(true);
    });

    expect(openMock).toHaveBeenCalledWith("", "_blank");
    expect(activeSessionGuard).toBeDefined();

    activeSessionGuard!.invalidate();

    await act(async () => {
      resolveEvidenceResponse(
        new Response("receipt-bytes", {
          status: 200,
          headers: {
            "Content-Type": "image/png"
          }
        })
      );

      await evidenceResponse;
    });

    await waitFor(() => {
      expect(evidenceWindow.close).toHaveBeenCalledTimes(1);
    });

    expect(createObjectURLMock).not.toHaveBeenCalled();
    expect(evidenceWindow.location.href).toBe("");
    expect(screen.getByText("Merchant A")).toBeTruthy();

    expect(
      screen.queryByText("Failed to load settlement evidence")
    ).toBeNull();

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(
          "/billing/settlements/settlement-a/evidence"
        )
      )
    ).toBe(true);
  });

  it("prevents overlapping login requests from rapid submissions", async () => {
    let resolveLogin!: (response: Response) => void;

    const pendingLogin = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });

    let loginRequests = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          loginRequests += 1;
          return pendingLogin;
        }

        if (url.includes("/merchants/")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    render(<App />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@example.com" }
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password" }
    });

    const form = screen.getByRole("button", {
      name: "Sign in"
    }).closest("form");

    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(loginRequests).toBe(1);

    await act(async () => {
      resolveLogin(new Response(JSON.stringify({
        token: "token-a",
        user: {
          id: "user-a",
          merchantId: "merchant-a",
          email: "a@example.com",
          displayName: "Merchant A",
          role: "STAFF"
        }
      }), { status: 200 }));

      await pendingLogin;
    });

    await screen.findByText("Merchant A");
  });

  it("allows login after an empty-email validation error", async () => {
    let loginRequests = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          loginRequests += 1;

          return new Response(JSON.stringify({
            token: "token-a",
            user: {
              id: "user-a",
              merchantId: "merchant-a",
              email: "a@example.com",
              displayName: "Merchant A",
              role: "STAFF"
            }
          }), { status: 200 });
        }

        if (url.includes("/merchants/")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    render(<App />);

    fireEvent.submit(
      screen.getByRole("button", {
        name: "Sign in"
      }).closest("form")!
    );

    expect(
      screen.getByText("Please enter your email.")
    ).toBeTruthy();

    expect(loginRequests).toBe(0);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@example.com" }
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "test-password" }
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in" })
    );

    await screen.findByText("Merchant A");

    expect(loginRequests).toBe(1);
  });

  it("ignores stored-session validation after unmount", async () => {
    localStorage.setItem("ethio-commerce-auth", JSON.stringify({
      token: "token-a",
      user: {
        id: "user-a",
        merchantId: "merchant-a",
        email: "a@example.com",
        displayName: "Merchant A",
        role: "STAFF"
      }
    }));

    let resolveValidation!: (response: Response) => void;

    const pendingValidation = new Promise<Response>((resolve) => {
      resolveValidation = resolve;
    });

    let validationRequests = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/auth/me")) {
        validationRequests += 1;
        return pendingValidation;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const view = render(<App />);

    await waitFor(() => {
      expect(validationRequests).toBe(1);
    });

    expect(screen.getByText("Validating your session...")).toBeTruthy();

    view.unmount();

    await act(async () => {
      resolveValidation(new Response(JSON.stringify({
        user: {
          id: "user-b",
          merchantId: "merchant-b",
          email: "b@example.com",
          displayName: "Merchant B",
          role: "STAFF"
        }
      }), { status: 200 }));

      await pendingValidation;
    });

    const stored = JSON.parse(
      localStorage.getItem("ethio-commerce-auth")!
    );

    expect(stored.token).toBe("token-a");
    expect(stored.user.merchantId).toBe("merchant-a");
  });
});
