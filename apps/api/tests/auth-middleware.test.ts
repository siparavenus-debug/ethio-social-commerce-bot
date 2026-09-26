import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  MerchantAccountStatus,
  MerchantUserRole,
  prisma
} from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess,
  requireRole
} from "../src/middleware/auth.js";

import {
  createAuthToken
} from "../src/services/auth.js";

function createMockResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };

  return res;
}

const testPrefix =
  "auth-middleware-account-enforcement";

async function cleanup(): Promise<void> {
  const merchants =
    await prisma.merchant.findMany({
      where: {
        name: {
          startsWith: testPrefix
        }
      },
      select: {
        id: true
      }
    });

  const merchantIds =
    merchants.map(
      (merchant) => merchant.id
    );

  if (merchantIds.length === 0) {
    return;
  }

  await prisma.merchantUser.deleteMany({
    where: {
      merchantId: {
        in: merchantIds
      }
    }
  });

  await prisma.merchant.deleteMany({
    where: {
      id: {
        in: merchantIds
      }
    }
  });
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

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

  it("rejects authentication for a suspended merchant account", async () => {
    const merchant =
      await prisma.merchant.create({
        data: {
          name:
            `${testPrefix}-suspended`,
          currency: "ETB",
          accountStatus:
            MerchantAccountStatus.SUSPENDED,
          accountSuspensionReason:
            "Suspicious account activity",
          accountSuspendedAt:
            new Date()
        }
      });

    const user =
      await prisma.merchantUser.create({
        data: {
          merchantId: merchant.id,
          email:
            `${testPrefix}-suspended@example.test`,
          passwordHash:
            "test-password-hash",
          displayName:
            "Suspended Merchant Owner",
          role:
            MerchantUserRole.OWNER,
          tokenVersion: 0
        }
      });

    const token =
      createAuthToken({
        id: user.id,
        merchantId: merchant.id,
        role: user.role,
        tokenVersion:
          user.tokenVersion
      });

    const req = {
      get: vi.fn().mockReturnValue(
        `Bearer ${token}`
      )
    } as any;

    const res = createMockResponse();
    const next = vi.fn();

    await requireAuth(
      req,
      res as any,
      next
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error:
        "Merchant account is suspended"
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows authentication for an active merchant account", async () => {
    const merchant =
      await prisma.merchant.create({
        data: {
          name:
            `${testPrefix}-active`,
          currency: "ETB"
        }
      });

    const user =
      await prisma.merchantUser.create({
        data: {
          merchantId: merchant.id,
          email:
            `${testPrefix}-active@example.test`,
          passwordHash:
            "test-password-hash",
          displayName:
            "Active Merchant Owner",
          role:
            MerchantUserRole.OWNER,
          tokenVersion: 0
        }
      });

    const token =
      createAuthToken({
        id: user.id,
        merchantId: merchant.id,
        role: user.role,
        tokenVersion:
          user.tokenVersion
      });

    const req = {
      get: vi.fn().mockReturnValue(
        `Bearer ${token}`
      )
    } as any;

    const res = createMockResponse();
    const next = vi.fn();

    await requireAuth(
      req,
      res as any,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.auth).toMatchObject({
      id: user.id,
      merchantId: merchant.id,
      email: user.email,
      role: user.role,
      tokenVersion:
        user.tokenVersion
    });
  });
});