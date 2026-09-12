import { describe, expect, it, vi } from "vitest";

import {
  requireAuth,
  requireMerchantAccess,
  requireRole
} from "../src/middleware/auth.js";

function createMockResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };

  return res;
}

describe("authentication middleware", () => {
  it("rejects a request without an Authorization header", async () => {
    const req = {
      get: vi.fn().mockReturnValue(undefined)
    } as any;

    const res = createMockResponse();
    const next = vi.fn();

    await requireAuth(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Authentication required"
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid authentication token", async () => {
    const req = {
      get: vi.fn().mockReturnValue(
        "Bearer invalid-token"
      )
    } as any;

    const res = createMockResponse();
    const next = vi.fn();

    await requireAuth(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error:
        "Invalid or expired authentication token"
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects merchant access when the requested merchant differs from the authenticated merchant", () => {
    const req = {
      params: {
        merchantId: "merchant-B"
      },
      auth: {
        id: "user-123",
        merchantId: "merchant-A",
        email: "merchant@example.com",
        displayName: "Merchant User",
        role: "OWNER"
      }
    } as any;

    const res = createMockResponse();
    const next = vi.fn();

    requireMerchantAccess(
      req,
      res as any,
      next
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error:
        "You are not authorized to access this merchant"
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows access when the requested merchant matches the authenticated merchant", () => {
    const req = {
      params: {
        merchantId: "merchant-A"
      },
      auth: {
        id: "user-123",
        merchantId: "merchant-A",
        email: "merchant@example.com",
        displayName: "Merchant User",
        role: "OWNER"
      }
    } as any;

    const res = createMockResponse();
    const next = vi.fn();

    requireMerchantAccess(
      req,
      res as any,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a user whose role is not allowed", () => {
    const req = {
      auth: {
        id: "user-123",
        merchantId: "merchant-A",
        email: "merchant@example.com",
        displayName: "Merchant User",
        role: "STAFF"
      }
    } as any;

    const res = createMockResponse();
    const next = vi.fn();

    requireRole("OWNER", "ADMIN")(
      req,
      res as any,
      next
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error:
        "You do not have permission to perform this action"
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a user whose role is allowed", () => {
    const req = {
      auth: {
        id: "user-123",
        merchantId: "merchant-A",
        email: "merchant@example.com",
        displayName: "Merchant User",
        role: "ADMIN"
      }
    } as any;

    const res = createMockResponse();
    const next = vi.fn();

    requireRole("OWNER", "ADMIN")(
      req,
      res as any,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});