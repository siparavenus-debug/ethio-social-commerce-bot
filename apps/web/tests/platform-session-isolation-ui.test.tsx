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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";

import PlatformApp from "../src/PlatformApp.js";

describe("platform session isolation UI", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("keeps Administrator B signed in after Administrator A receives a delayed 401", async () => {
    let resolveOldRequest!: (response: Response) => void;

    const oldRequest = new Promise<Response>((resolve) => {
      resolveOldRequest = resolve;
    });

    const fetchMock = vi.spyOn(
      globalThis,
      "fetch"
    ).mockImplementation(async (input, init) => {
      const url = String(input);
      const authorization = new Headers(
        init?.headers
      ).get("Authorization");

      if (url.endsWith("/platform/auth/login")) {
        const body = JSON.parse(String(init?.body));
        const isA = body.email === "a@example.com";

        return new Response(
          JSON.stringify({
            token: isA ? "token-a" : "token-b"
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/platform/auth/me")) {
        const isA = authorization === "Bearer token-a";

        return new Response(
          JSON.stringify({
            user: {
              id: isA ? "admin-a" : "admin-b",
              email: isA
                ? "a@example.com"
                : "b@example.com",
              displayName: isA
                ? "Administrator A"
                : "Administrator B"
            }
          }),
          { status: 200 }
        );
      }

      if (
        url.endsWith("/platform/merchants") &&
        authorization === "Bearer token-a"
      ) {
        return oldRequest;
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

      throw new Error(`Unexpected request: ${url}`);
    });

    render(<PlatformApp />);

    async function signIn(email: string) {
      fireEvent.change(
        screen.getByLabelText("Email"),
        { target: { value: email } }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        { target: { value: "test-password" } }
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Sign in" })
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            email.startsWith("a")
              ? "Administrator A"
              : "Administrator B"
          )
        ).toBeTruthy();
      });
    }

    await signIn("a@example.com");

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) =>
          String(input).endsWith("/platform/merchants") &&
          new Headers(init?.headers).get("Authorization") ===
            "Bearer token-a"
        )
      ).toBe(true);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign out" })
    );

    await signIn("b@example.com");

    await act(async () => {
      resolveOldRequest(
        new Response(
          JSON.stringify({ error: "Session expired" }),
          { status: 401 }
        )
      );

      await oldRequest;
    });

    await waitFor(() => {
      expect(
        screen.getByText("Administrator B")
      ).toBeTruthy();

      expect(
        screen.getByRole("button", { name: "Sign out" })
      ).toBeTruthy();

      expect(
        sessionStorage.getItem(
          "ethio-commerce-platform-token"
        )
      ).toBe("token-b");
    });
  });
  it("keeps Administrator B signed in after Administrator A's delayed password change succeeds", async () => {
    let resolvePasswordResponse!: (response: Response) => void;

    const passwordResponse = new Promise<Response>((resolve) => {
      resolvePasswordResponse = resolve;
    });

    let passwordRequestStarted = false;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        const authorization = new Headers(
          init?.headers
        ).get("Authorization");

        if (url.endsWith("/platform/auth/login")) {
          const body = JSON.parse(String(init?.body));
          const isA = body.email === "a@example.com";

          return new Response(
            JSON.stringify({
              token: isA ? "token-a" : "token-b"
            }),
            { status: 200 }
          );
        }

        if (url.endsWith("/platform/auth/me")) {
          const isA = authorization === "Bearer token-a";

          return new Response(
            JSON.stringify({
              user: {
                id: isA ? "admin-a" : "admin-b",
                email: isA
                  ? "a@example.com"
                  : "b@example.com",
                displayName: isA
                  ? "Administrator A"
                  : "Administrator B",
                role: "ADMIN"
              }
            }),
            { status: 200 }
          );
        }

        if (url.endsWith("/platform/auth/password")) {
          expect(init?.method).toBe("PATCH");
          expect(authorization).toBe("Bearer token-a");

          passwordRequestStarted = true;
          return passwordResponse;
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

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    render(<PlatformApp />);

    async function signIn(email: string) {
      fireEvent.change(
        screen.getByLabelText("Email"),
        { target: { value: email } }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        { target: { value: "test-password" } }
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Sign in" })
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            email.startsWith("a")
              ? "Administrator A"
              : "Administrator B"
          )
        ).toBeTruthy();
      });
    }

    await signIn("a@example.com");

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
      screen.getByLabelText("New password"),
      { target: { value: "new-password-123" } }
    );

    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() => {
      expect(passwordRequestStarted).toBe(true);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign out" })
    );

    await signIn("b@example.com");

    await act(async () => {
      resolvePasswordResponse(
        new Response(
          JSON.stringify({ success: true }),
          { status: 200 }
        )
      );

      await passwordResponse;
    });

    expect(
      screen.getByText("Administrator B")
    ).toBeTruthy();

    expect(
      screen.getByRole("button", { name: "Sign out" })
    ).toBeTruthy();

    expect(
      sessionStorage.getItem(
        "ethio-commerce-platform-token"
      )
    ).toBe("token-b");
  });
  it("prevents Administrator A's delayed settlement evidence from opening after Administrator B signs in", async () => {
    let resolveEvidence!: (response: Response) => void;

    const evidenceResponse = new Promise<Response>(resolve => {
      resolveEvidence = resolve;
    });

    let evidenceStarted = false;

    const evidenceWindow = {
      opener: null as unknown,
      location: { href: "" },
      close: vi.fn()
    };

    vi.spyOn(window, "open").mockImplementation(
      () => evidenceWindow as unknown as Window
    );

    const createObjectURL = vi.spyOn(
      URL,
      "createObjectURL"
    ).mockImplementation(() => "blob:old-admin-receipt");

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        const authorization = new Headers(
          init?.headers
        ).get("Authorization");

        if (url.endsWith("/platform/auth/login")) {
          const body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({
            token: body.email === "a@example.com"
              ? "token-a"
              : "token-b"
          }), { status: 200 });
        }

        if (url.endsWith("/platform/auth/me")) {
          const isA = authorization === "Bearer token-a";
          return new Response(JSON.stringify({
            user: {
              id: isA ? "admin-a" : "admin-b",
              email: isA ? "a@example.com" : "b@example.com",
              displayName: isA
                ? "Administrator A"
                : "Administrator B",
              role: "ADMIN"
            }
          }), { status: 200 });
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
            "/platform/billing/settlements/review"
          )
        ) {
          return new Response(JSON.stringify({
            settlements: [{
              id: "settlement-a",
              merchant: { id: "merchant-a", name: "Merchant A" },
              merchantName: "Merchant A",
              invoiceId: "invoice-a",
              amount: "500.00",
              currency: "ETB",
              status: "REVIEW_REQUIRED",
              provider: "Telebirr",
              transactionReference: "REFERENCE-A",
              hasReceiptEvidence: true,
              receiptUrl: null,
              submittedAt: "2026-10-23T08:00:00.000Z"
            }]
          }), { status: 200 });
        }

        if (
          url.endsWith("/platform/billing/work/summary")
        ) {
          return new Response(JSON.stringify({
            pending: {
              draftInvoices: 0,
              awaitingPayment: 0,
              paymentReview: 1,
              total: 1
            },
            resolvedToday: {
              verified: 0,
              rejected: 0,
              total: 0
            }
          }), { status: 200 });
        }

        if (
          url.endsWith(
            "/platform/merchants/merchant-a/billing/settlements/settlement-a/evidence"
          )
        ) {
          expect(authorization).toBe("Bearer token-a");
          evidenceStarted = true;
          return evidenceResponse;
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    render(<PlatformApp />);

    async function signIn(email: string) {
      fireEvent.change(
        screen.getByLabelText("Email"),
        { target: { value: email } }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        { target: { value: "test-password" } }
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Sign in" })
      );

      await screen.findByText(
        email === "a@example.com"
          ? "Administrator A"
          : "Administrator B"
      );
    }

    await signIn("a@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "Billing Work" })
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "View receipt"
      })
    );

    await waitFor(() => {
      expect(evidenceStarted).toBe(true);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign out" })
    );

    await signIn("b@example.com");

    await act(async () => {
      resolveEvidence(
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

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(evidenceWindow.location.href).toBe("");

    expect(screen.getByText("Administrator B")).toBeTruthy();

    expect(
      sessionStorage.getItem(
        "ethio-commerce-platform-token"
      )
    ).toBe("token-b");
  });

  it("keeps Administrator B signed in after Administrator A's delayed settlement evidence returns 401", async () => {
    let resolveEvidence!: (response: Response) => void;

    const evidenceResponse = new Promise<Response>(resolve => {
      resolveEvidence = resolve;
    });

    let evidenceStarted = false;

    const evidenceWindow = {
      opener: null as unknown,
      location: { href: "" },
      close: vi.fn()
    };

    vi.spyOn(window, "open").mockImplementation(
      () => evidenceWindow as unknown as Window
    );

    const createObjectURL = vi.spyOn(
      URL,
      "createObjectURL"
    ).mockImplementation(() => "blob:old-admin-receipt");

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        const authorization = new Headers(
          init?.headers
        ).get("Authorization");

        if (url.endsWith("/platform/auth/login")) {
          const body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({
            token: body.email === "a@example.com"
              ? "token-a"
              : "token-b"
          }), { status: 200 });
        }

        if (url.endsWith("/platform/auth/me")) {
          const isA = authorization === "Bearer token-a";
          return new Response(JSON.stringify({
            user: {
              id: isA ? "admin-a" : "admin-b",
              email: isA ? "a@example.com" : "b@example.com",
              displayName: isA
                ? "Administrator A"
                : "Administrator B",
              role: "ADMIN"
            }
          }), { status: 200 });
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
            "/platform/billing/settlements/review"
          )
        ) {
          return new Response(JSON.stringify({
            settlements: [{
              id: "settlement-a",
              merchant: { id: "merchant-a", name: "Merchant A" },
              merchantName: "Merchant A",
              invoiceId: "invoice-a",
              amount: "500.00",
              currency: "ETB",
              status: "REVIEW_REQUIRED",
              provider: "Telebirr",
              transactionReference: "REFERENCE-A",
              hasReceiptEvidence: true,
              receiptUrl: null,
              submittedAt: "2026-10-23T08:00:00.000Z"
            }]
          }), { status: 200 });
        }

        if (
          url.endsWith("/platform/billing/work/summary")
        ) {
          return new Response(JSON.stringify({
            pending: {
              draftInvoices: 0,
              awaitingPayment: 0,
              paymentReview: 1,
              total: 1
            },
            resolvedToday: {
              verified: 0,
              rejected: 0,
              total: 0
            }
          }), { status: 200 });
        }

        if (
          url.endsWith(
            "/platform/merchants/merchant-a/billing/settlements/settlement-a/evidence"
          )
        ) {
          expect(authorization).toBe("Bearer token-a");
          evidenceStarted = true;
          return evidenceResponse;
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    render(<PlatformApp />);

    async function signIn(email: string) {
      fireEvent.change(
        screen.getByLabelText("Email"),
        { target: { value: email } }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        { target: { value: "test-password" } }
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Sign in" })
      );

      await screen.findByText(
        email === "a@example.com"
          ? "Administrator A"
          : "Administrator B"
      );
    }

    await signIn("a@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "Billing Work" })
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "View receipt"
      })
    );

    await waitFor(() => {
      expect(evidenceStarted).toBe(true);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign out" })
    );

    await signIn("b@example.com");

    await act(async () => {
      resolveEvidence(
        new Response(
          JSON.stringify({ error: "Unauthorized" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      );

      await evidenceResponse;
    });

    await waitFor(() => {
      expect(evidenceWindow.close).toHaveBeenCalledTimes(1);
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(evidenceWindow.location.href).toBe("");

    expect(screen.getByText("Administrator B")).toBeTruthy();

    expect(
      sessionStorage.getItem(
        "ethio-commerce-platform-token"
      )
    ).toBe("token-b");
  });
  it("keeps Administrator B's identity after Administrator A's delayed session validation succeeds", async () => {
    let resolveOldValidation!: (response: Response) => void;

    const oldValidation = new Promise<Response>(resolve => {
      resolveOldValidation = resolve;
    });

    let validationCountA = 0;
    let oldValidationStarted = false;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        const authorization = new Headers(
          init?.headers
        ).get("Authorization");

        if (url.endsWith("/platform/auth/login")) {
          const body = JSON.parse(String(init?.body));

          return new Response(JSON.stringify({
            token: body.email === "a@example.com"
              ? "token-a"
              : "token-b"
          }), { status: 200 });
        }

        if (url.endsWith("/platform/auth/me")) {
          const isA = authorization === "Bearer token-a";

          if (isA) {
            validationCountA++;

            if (validationCountA === 2) {
              oldValidationStarted = true;
              return oldValidation;
            }
          }

          return new Response(JSON.stringify({
            user: {
              id: isA ? "admin-a" : "admin-b",
              email: isA
                ? "a@example.com"
                : "b@example.com",
              displayName: isA
                ? "Administrator A"
                : "Administrator B",
              role: "ADMIN"
            }
          }), { status: 200 });
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

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    render(<PlatformApp />);

    async function signIn(email: string) {
      fireEvent.change(
        screen.getByLabelText("Email"),
        { target: { value: email } }
      );

      fireEvent.change(
        screen.getByLabelText("Password"),
        { target: { value: "test-password" } }
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Sign in" })
      );

      await screen.findByText(
        email === "a@example.com"
          ? "Administrator A"
          : "Administrator B"
      );
    }

    await signIn("a@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh" })
    );

    await waitFor(() => {
      expect(oldValidationStarted).toBe(true);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Sign out" })
    );

    await signIn("b@example.com");

    await act(async () => {
      resolveOldValidation(
        new Response(JSON.stringify({
          user: {
            id: "admin-a",
            email: "a@example.com",
            displayName: "Administrator A",
            role: "ADMIN"
          }
        }), { status: 200 })
      );

      await oldValidation;
    });

    await waitFor(() => {
      expect(
        screen.getByText("Administrator B")
      ).toBeTruthy();
    });

    expect(
      screen.queryByText("Administrator A")
    ).toBeNull();

    expect(
      sessionStorage.getItem(
        "ethio-commerce-platform-token"
      )
    ).toBe("token-b");
  });
  it("prevents overlapping platform login requests from rapid submissions", async () => {
    let resolveLogin!: (response: Response) => void;

    const pendingLogin = new Promise<Response>(resolve => {
      resolveLogin = resolve;
    });

    let loginRequests = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);

        if (url.endsWith("/platform/auth/login")) {
          loginRequests++;
          return pendingLogin;
        }

        if (url.endsWith("/platform/auth/me")) {
          return new Response(JSON.stringify({
            user: {
              id: "admin-a",
              email: "a@example.com",
              displayName: "Administrator A",
              role: "ADMIN"
            }
          }), { status: 200 });
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

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    render(<PlatformApp />);

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
      resolveLogin(
        new Response(JSON.stringify({
          token: "token-a"
        }), { status: 200 })
      );

      await pendingLogin;
    });

    await screen.findByText("Administrator A");
  });
});
