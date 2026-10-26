// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App.js";
import * as sessionGuardModule from "../src/session-guard.js";

describe("merchant inventory session isolation UI", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("ignores a delayed product creation response after session invalidation", async () => {
    let resolveProductJson!: (value: unknown) => void;
    let productJsonStarted = false;

    const productJson = new Promise<unknown>((resolve) => {
      resolveProductJson = resolve;
    });

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
              role: "OWNER"
            }
          }), { status: 200 });
        }

        if (
          url.endsWith("/merchants/merchant-a/products") &&
          init?.method === "POST"
        ) {
          const response = new Response("{}", { status: 201 });

          response.json = async () => {
            productJsonStarted = true;
            return productJson;
          };

          return response;
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
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("Merchant A");

    fireEvent.click(screen.getByRole("button", { name: /Inventory/i }));

    fireEvent.click(screen.getByRole("button", { name: /Add Product/i }));

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Session Isolation Test" }
    });
    fireEvent.change(screen.getByLabelText("Price"), {
      target: { value: "100" }
    });
    fireEvent.change(screen.getByLabelText("Currency"), {
      target: { value: "ETB" }
    });
    fireEvent.change(screen.getByLabelText("Stock"), {
      target: { value: "5" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Product" }));

    await waitFor(() => {
      expect(productJsonStarted).toBe(true);
    });

    expect(activeSessionGuard).toBeDefined();

    const requestsBeforeResolution = fetchMock.mock.calls.length;

    activeSessionGuard!.invalidate();

    await act(async () => {
      resolveProductJson({ id: "product-a" });
      await productJson;
    });

    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(
      (screen.getByLabelText("Name") as HTMLInputElement).value
    ).toBe("Session Isolation Test");

    expect(screen.queryByText("Product created successfully.")).toBeNull();

    expect(fetchMock.mock.calls.length).toBe(requestsBeforeResolution);
  });
});
