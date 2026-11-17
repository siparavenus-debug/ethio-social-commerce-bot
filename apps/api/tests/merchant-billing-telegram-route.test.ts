
import type { Server } from "node:http";
import { AddressInfo } from "node:net";

import express from "express";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";


const databaseMocks = vi.hoisted(() => ({
    findUser: vi.fn(),
    findDestination: vi.fn()
  }));

  const tokenServiceMocks = vi.hoisted(() => ({
    createToken: vi.fn()
  }));

  const preferenceServiceMocks = vi.hoisted(() => ({
    updatePreferences: vi.fn()
  }));

  const unlinkServiceMocks = vi.hoisted(() => ({
    unlink: vi.fn()
  }));

  vi.mock(
    "../src/services/merchant-billing-telegram-unlink.js",
    () => ({
      unlinkBillingTelegramDestination:
        unlinkServiceMocks.unlink
    })
  );
  vi.mock(
    "../src/services/merchant-billing-telegram-preferences.js",
    async (importOriginal) => {
      const actual = await importOriginal<
        typeof import(
          "../src/services/merchant-billing-telegram-preferences.js"
        )
      >();

      return {
        ...actual,
        updateBillingTelegramPreferences:
          preferenceServiceMocks.updatePreferences
      };
    }
  );

  vi.mock(
    "@ethio-commerce/database",
    async (importOriginal) => {
      const actual =
        await importOriginal<
          typeof import("@ethio-commerce/database")
        >();

      return {
        ...actual,
        prisma: {
          merchantUser: {
            findUnique: databaseMocks.findUser
          },
          merchantBillingTelegramDestination: {
            findFirst: databaseMocks.findDestination
          }
        }
      };
    }
  );

  vi.mock(
    "../src/services/merchant-billing-telegram-link-token.js",
    async (importOriginal) => {
      const actual = await importOriginal<
        typeof import(
          "../src/services/merchant-billing-telegram-link-token.js"
        )
      >();

      return {
        ...actual,
        createBillingTelegramLinkToken:
          tokenServiceMocks.createToken
      };
    }
  );

import merchantBillingTelegramRouter from
  "../src/routes/merchant-billing-telegram.js";

import {
  createAuthToken
} from "../src/services/auth.js";

const merchantA = "b3-test-merchant-a";
const merchantB = "b3-test-merchant-b";

function makeUser(
  role: "OWNER" | "ADMIN" | "STAFF" = "OWNER",
  merchantId = merchantA,
  suspended = false
) {
  return {
    id: "b3-test-user",
    merchantId,
    email: "owner@example.test",
    displayName: "Test Owner",
    role,
    tokenVersion: 0,
    merchant: {
      accountStatus: suspended
        ? "SUSPENDED"
        : "ACTIVE"
    }
  };
}

function tokenFor(user: ReturnType<typeof makeUser>) {
  return createAuthToken({
    id: user.id,
    merchantId: user.merchantId,
    role: user.role,
    tokenVersion: user.tokenVersion
  });
}

describe("B3.1 billing Telegram OWNER authorization", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();

    app.use(express.json());

    app.use(
      "/merchants",
      merchantBillingTelegramRouter
    );

    server = await new Promise<Server>((resolve) => {
      const listeningServer = app.listen(
        0,
        "127.0.0.1",
        () => resolve(listeningServer)
      );
    });

    const address = server.address() as AddressInfo;

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error ? reject(error) : resolve()
        );
      });
    }
  });

  beforeEach(() => {
    vi.resetAllMocks();

    databaseMocks.findDestination.mockResolvedValue(null);
  });

  async function request(
    merchantId: string,
    token?: string,
    method: "GET" | "POST" = "GET"
  ) {
    const path =
      method === "POST"
        ? `/merchants/${merchantId}/billing-telegram/link-token`
        : `/merchants/${merchantId}/billing-telegram`;

    return fetch(`${baseUrl}${path}`, {
      method,
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : {}
    });
  }

  it("rejects unauthenticated requests", async () => {
    const response = await request(merchantA);

    expect(response.status).toBe(401);
    expect(databaseMocks.findDestination)
      .not.toHaveBeenCalled();
  });

  it("rejects invalid bearer tokens", async () => {
    const response = await request(
      merchantA,
      "invalid-token"
    );

    expect(response.status).toBe(401);
    expect(databaseMocks.findDestination)
      .not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "STAFF"] as const)(
    "rejects %s users",
    async (role) => {
      const user = makeUser(role);

      databaseMocks.findUser.mockResolvedValue(user);

      const response = await request(
        merchantA,
        tokenFor(user)
      );

      expect(response.status).toBe(403);
      expect(databaseMocks.findDestination)
        .not.toHaveBeenCalled();
    }
  );

  it("rejects cross-merchant access", async () => {
    const user = makeUser();

    databaseMocks.findUser.mockResolvedValue(user);

    const response = await request(
      merchantB,
      tokenFor(user)
    );

    expect(response.status).toBe(403);
    expect(databaseMocks.findDestination)
      .not.toHaveBeenCalled();
  });

  it("rejects suspended merchant accounts", async () => {
    const user = makeUser(
      "OWNER",
      merchantA,
      true
    );

    databaseMocks.findUser.mockResolvedValue(user);

    const response = await request(
      merchantA,
      tokenFor(user)
    );

    expect(response.status).toBe(403);
    expect(databaseMocks.findDestination)
      .not.toHaveBeenCalled();
  });

  it("rejects stale token versions", async () => {
    const user = makeUser();

    databaseMocks.findUser.mockResolvedValue({
      ...user,
      tokenVersion: 1
    });

    const response = await request(
      merchantA,
      tokenFor(user)
    );

    expect(response.status).toBe(401);
    expect(databaseMocks.findDestination)
      .not.toHaveBeenCalled();
  });

  it("returns unlinked for an OWNER without a destination", async () => {
    const user = makeUser();

    databaseMocks.findUser.mockResolvedValue(user);

    const response = await request(
      merchantA,
      tokenFor(user)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      linked: false,
      destination: null
    });

    expect(databaseMocks.findDestination)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            merchantId: merchantA,
            status: "ACTIVE",
            revokedAt: null
          }
        })
      );
  });

  it("returns the active destination for its OWNER", async () => {
    const user = makeUser();

    databaseMocks.findUser.mockResolvedValue(user);

    const destination = {
      id: "destination-a",
      platformBotId: "platform-bot-a",
      chatId: "123456",
      telegramUserId: "789012",
      status: "ACTIVE",
      linkVersion: 1,
      notificationsEnabled: true,
      consentedAt: new Date(
        "2026-11-05T00:00:00.000Z"
      ),
      createdAt: new Date(
        "2026-11-05T00:00:00.000Z"
      ),
      updatedAt: new Date(
        "2026-11-05T00:00:00.000Z"
      )
    };

    databaseMocks.findDestination.mockResolvedValue(
      destination
    );

    const response = await request(
      merchantA,
      tokenFor(user)
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.linked).toBe(true);
    expect(body.destination.id).toBe(destination.id);
    expect(body.destination.maskedTelegramAccount)
      .toBe("••••9012");
    expect(body.destination).not.toHaveProperty("chatId");
    expect(body.destination).not.toHaveProperty(
      "telegramUserId"
    );
    expect(body.destination.notificationsEnabled).toBe(true);
    expect(response.headers.get("cache-control"))
      .toBe("no-store");
  });

  it("does not return revoked destinations", async () => {
    const user = makeUser();

    databaseMocks.findUser.mockResolvedValue(user);

    const response = await request(
      merchantA,
      tokenFor(user)
    );

    expect(response.status).toBe(200);
    expect((await response.json()).linked).toBe(false);

    expect(databaseMocks.findDestination)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "ACTIVE",
            revokedAt: null
          })
        })
      );
  });

  it("does not require a commerce subscription", async () => {
    const user = makeUser();

    databaseMocks.findUser.mockResolvedValue(user);

    const response = await request(
      merchantA,
      tokenFor(user)
    );

    expect(response.status).toBe(200);
  });


describe("B3.2 OWNER link-token HTTP security", () => {
    beforeEach(() => {
      tokenServiceMocks.createToken.mockResolvedValue({
        token: "test-only-raw-link-token",
        expiresAt: new Date(
          "2026-11-06T12:10:00.000Z"
        )
      });
    });

    it("rejects unauthenticated POST requests", async () => {
      const response = await request(
        merchantA,
        undefined,
        "POST"
      );

      expect(response.status).toBe(401);
      expect(tokenServiceMocks.createToken)
        .not.toHaveBeenCalled();
    });

    it("rejects invalid bearer tokens", async () => {
      const response = await request(
        merchantA,
        "invalid-token",
        "POST"
      );

      expect(response.status).toBe(401);
      expect(tokenServiceMocks.createToken)
        .not.toHaveBeenCalled();
    });

    it.each(["ADMIN", "STAFF"] as const)(
      "rejects %s users",
      async (role) => {
        const user = makeUser(role);

        databaseMocks.findUser.mockResolvedValue(user);

        const response = await request(
          merchantA,
          tokenFor(user),
          "POST"
        );

        expect(response.status).toBe(403);
        expect(tokenServiceMocks.createToken)
          .not.toHaveBeenCalled();
      }
    );

    it("rejects cross-merchant POST requests", async () => {
      const user = makeUser();

      databaseMocks.findUser.mockResolvedValue(user);

      const response = await request(
        merchantB,
        tokenFor(user),
        "POST"
      );

      expect(response.status).toBe(403);
      expect(tokenServiceMocks.createToken)
        .not.toHaveBeenCalled();
    });

    it("rejects suspended merchant accounts", async () => {
      const user = makeUser(
        "OWNER",
        merchantA,
        true
      );

      databaseMocks.findUser.mockResolvedValue(user);

      const response = await request(
        merchantA,
        tokenFor(user),
        "POST"
      );

      expect(response.status).toBe(403);
      expect(tokenServiceMocks.createToken)
        .not.toHaveBeenCalled();
    });

    it("rejects stale authentication versions", async () => {
      const user = makeUser();

      databaseMocks.findUser.mockResolvedValue({
        ...user,
        tokenVersion: 1
      });

      const response = await request(
        merchantA,
        tokenFor(user),
        "POST"
      );

      expect(response.status).toBe(401);
      expect(tokenServiceMocks.createToken)
        .not.toHaveBeenCalled();
    });

    it("issues a token only for its authenticated OWNER", async () => {
      const user = makeUser();

      databaseMocks.findUser.mockResolvedValue(user);

      const response = await request(
        merchantA,
        tokenFor(user),
        "POST"
      );

      expect(response.status).toBe(201);

      expect(tokenServiceMocks.createToken)
        .toHaveBeenCalledExactlyOnceWith(
          merchantA,
          user.id,
          user.tokenVersion
        );

      expect(await response.json()).toEqual({
        token: "test-only-raw-link-token",
        expiresAt: "2026-11-06T12:10:00.000Z"
      });

      expect(response.headers.get("cache-control"))
        .toBe("no-store");

      expect(response.headers.get("pragma"))
        .toBe("no-cache");
    });

    it("does not require a commerce subscription", async () => {
      const user = makeUser();

      databaseMocks.findUser.mockResolvedValue(user);

      const response = await request(
        merchantA,
        tokenFor(user),
        "POST"
      );

      expect(response.status).toBe(201);
      expect(tokenServiceMocks.createToken)
        .toHaveBeenCalledOnce();
    });


    it("returns 403 for link eligibility failures", async () => {
        const user = makeUser();

        databaseMocks.findUser.mockResolvedValue(user);

        const {
          BillingTelegramLinkNotEligibleError
        } = await import(
          "../src/services/merchant-billing-telegram-link-token.js"
        );

        tokenServiceMocks.createToken.mockRejectedValue(
          new BillingTelegramLinkNotEligibleError()
        );

        const response = await request(
          merchantA,
          tokenFor(user),
          "POST"
        );

        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control"))
          .toBe("no-store");

        const body = await response.json();

        expect(body).toEqual({
          error:
            "Billing Telegram link token could not be issued"
        });
      });

      it("returns 500 without exposing internal service errors", async () => {
        const user = makeUser();

        databaseMocks.findUser.mockResolvedValue(user);

        tokenServiceMocks.createToken.mockRejectedValue(
          new Error("internal-database-detail")
        );

        const response = await request(
          merchantA,
          tokenFor(user),
          "POST"
        );

        expect(response.status).toBe(500);
        expect(response.headers.get("cache-control"))
          .toBe("no-store");

        expect(response.headers.get("pragma"))
          .toBe("no-cache");

        const body = await response.json();

        expect(body).toEqual({
          error:
            "Billing Telegram link token could not be issued"
        });

        expect(JSON.stringify(body))
          .not.toContain("internal-database-detail");
      });

      describe("B3.6 OWNER billing Telegram preferences", () => {
        it("allows the authenticated OWNER to disable notifications", async () => {
          const user = makeUser();

          databaseMocks.findUser.mockResolvedValue(user);

          preferenceServiceMocks.updatePreferences.mockResolvedValue({
            ok: true,
            notificationsEnabled: false,
            suppressedDeliveries: 2
          });

          const response = await fetch(
            `${baseUrl}/merchants/${merchantA}/billing-telegram/preferences`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${tokenFor(user)}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                notificationsEnabled: false
              })
            }
          );

          expect(response.status).toBe(200);

          expect(await response.json()).toEqual({
            notificationsEnabled: false,
            suppressedDeliveries: 2
          });

          expect(preferenceServiceMocks.updatePreferences)
            .toHaveBeenCalledExactlyOnceWith(
              merchantA,
              user.id,
              user.tokenVersion,
              false
            );

          expect(response.headers.get("cache-control"))
            .toBe("no-store");
        });
      });


it("rejects unauthenticated preference updates", async () => {
  const response = await fetch(
    `${baseUrl}/merchants/${merchantA}/billing-telegram/preferences`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        notificationsEnabled: false
      })
    }
  );

  expect(response.status).toBe(401);
  expect(preferenceServiceMocks.updatePreferences)
    .not.toHaveBeenCalled();
});

it.each(["ADMIN", "STAFF"] as const)(
  "rejects %s preference updates",
  async (role) => {
    const user = makeUser(role);

    databaseMocks.findUser.mockResolvedValue(user);

    const response = await fetch(
      `${baseUrl}/merchants/${merchantA}/billing-telegram/preferences`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokenFor(user)}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notificationsEnabled: false
        })
      }
    );

    expect(response.status).toBe(403);
    expect(preferenceServiceMocks.updatePreferences)
      .not.toHaveBeenCalled();
  }
);

it("rejects cross-merchant preference updates", async () => {
  const user = makeUser();

  databaseMocks.findUser.mockResolvedValue(user);

  const response = await fetch(
    `${baseUrl}/merchants/${merchantB}/billing-telegram/preferences`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenFor(user)}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        notificationsEnabled: false
      })
    }
  );

  expect(response.status).toBe(403);
  expect(preferenceServiceMocks.updatePreferences)
    .not.toHaveBeenCalled();
});


it("rejects suspended merchant preference updates", async () => {
  const user = makeUser("OWNER", merchantA, true);

  databaseMocks.findUser.mockResolvedValue(user);

  const response = await fetch(
    `${baseUrl}/merchants/${merchantA}/billing-telegram/preferences`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenFor(user)}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        notificationsEnabled: false
      })
    }
  );

  expect(response.status).toBe(403);
  expect(preferenceServiceMocks.updatePreferences)
    .not.toHaveBeenCalled();
});

it("rejects stale authentication for preference updates", async () => {
  const user = makeUser();

  databaseMocks.findUser.mockResolvedValue({
    ...user,
    tokenVersion: user.tokenVersion + 1
  });

  const response = await fetch(
    `${baseUrl}/merchants/${merchantA}/billing-telegram/preferences`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenFor(user)}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        notificationsEnabled: false
      })
    }
  );

  expect(response.status).toBe(401);
  expect(preferenceServiceMocks.updatePreferences)
    .not.toHaveBeenCalled();
});


it.each([
  ["missing preference", {}],
  ["string preference", { notificationsEnabled: "false" }],
  ["numeric preference", { notificationsEnabled: 0 }],
  ["null preference", { notificationsEnabled: null }],
  [
    "unexpected additional field",
    { notificationsEnabled: false, merchantId: merchantB }
  ],
  ["array body", [false]]
])(
  "rejects invalid preference body: %s",
  async (_description, body) => {
    const user = makeUser();

    databaseMocks.findUser.mockResolvedValue(user);

    const response = await fetch(
      `${baseUrl}/merchants/${merchantA}/billing-telegram/preferences`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokenFor(user)}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    expect(response.status).toBe(400);

    expect(await response.json()).toEqual({
      error: "Invalid billing Telegram preferences"
    });

    expect(preferenceServiceMocks.updatePreferences)
      .not.toHaveBeenCalled();
  }
);


it.each([
  [
    "UNSAFE_IN_FLIGHT",
    409,
    "Billing Telegram preferences cannot change while deliveries require safety review"
  ],
  [
    "NOT_ELIGIBLE",
    403,
    "Billing Telegram preference update not permitted"
  ]
] as const)(
  "returns the expected HTTP status for preference rejection: %s",
  async (reason, expectedStatus, expectedError) => {
    const user = makeUser();

    databaseMocks.findUser.mockResolvedValue(user);

    preferenceServiceMocks.updatePreferences.mockResolvedValue({
      ok: false,
      reason
    });

    const response = await fetch(
      `${baseUrl}/merchants/${merchantA}/billing-telegram/preferences`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokenFor(user)}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notificationsEnabled: false
        })
      }
    );

    expect(response.status).toBe(expectedStatus);

    expect(await response.json()).toEqual({
      error: expectedError
    });

    expect(preferenceServiceMocks.updatePreferences)
      .toHaveBeenCalledExactlyOnceWith(
        merchantA,
        user.id,
        user.tokenVersion,
        false
      );

    expect(response.headers.get("cache-control"))
      .toBe("no-store");
  }
);


it("returns a sanitized 500 for unexpected preference service errors", async () => {
  const user = makeUser();

  databaseMocks.findUser.mockResolvedValue(user);

  preferenceServiceMocks.updatePreferences.mockRejectedValue(
    new Error("internal-database-detail")
  );

  const response = await fetch(
    `${baseUrl}/merchants/${merchantA}/billing-telegram/preferences`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenFor(user)}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        notificationsEnabled: false
      })
    }
  );

  expect(response.status).toBe(500);

  const body = await response.json();

  expect(body).toEqual({
    error: "Failed to update billing Telegram preferences"
  });

  expect(JSON.stringify(body))
    .not.toContain("internal-database-detail");

  expect(response.headers.get("cache-control"))
    .toBe("no-store");
});


  describe("B3.6 billing Telegram unlink HTTP route", () => {
    async function unlinkRequest(
      merchantId: string,
      token?: string
    ) {
      return fetch(
        `${baseUrl}/merchants/${merchantId}/billing-telegram/unlink`,
        {
          method: "POST",
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : {}
        }
      );
    }

    it.each([
      [true, true],
      [false, false]
    ])(
      "returns 200 for successful OWNER unlink (unlinked=%s)",
      async (unlinked) => {
        const user = makeUser();

        databaseMocks.findUser.mockResolvedValue(user);
        unlinkServiceMocks.unlink.mockResolvedValue({
          ok: true,
          unlinked
        });

        const response = await unlinkRequest(
          merchantA,
          tokenFor(user)
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          linked: false,
          unlinked
        });

        expect(unlinkServiceMocks.unlink)
          .toHaveBeenCalledExactlyOnceWith(
            merchantA,
            user.id,
            user.tokenVersion
          );

        expect(response.headers.get("cache-control"))
          .toBe("no-store");
      }
    );

    it("rejects unauthenticated unlink", async () => {
      const response = await unlinkRequest(merchantA);

      expect(response.status).toBe(401);
      expect(unlinkServiceMocks.unlink)
        .not.toHaveBeenCalled();
    });

    it("rejects invalid bearer tokens", async () => {
      const response = await unlinkRequest(
        merchantA,
        "invalid-token"
      );

      expect(response.status).toBe(401);
      expect(unlinkServiceMocks.unlink)
        .not.toHaveBeenCalled();
    });

    it.each(["ADMIN", "STAFF"] as const)(
      "rejects unlink by %s",
      async (role) => {
        const user = makeUser(role);

        databaseMocks.findUser.mockResolvedValue(user);

        const response = await unlinkRequest(
          merchantA,
          tokenFor(user)
        );

        expect(response.status).toBe(403);
        expect(unlinkServiceMocks.unlink)
          .not.toHaveBeenCalled();
      }
    );

    it("rejects cross-merchant unlink", async () => {
      const user = makeUser();

      databaseMocks.findUser.mockResolvedValue(user);

      const response = await unlinkRequest(
        merchantB,
        tokenFor(user)
      );

      expect(response.status).toBe(403);
      expect(unlinkServiceMocks.unlink)
        .not.toHaveBeenCalled();
    });

    it("rejects suspended merchant unlink", async () => {
      const user = makeUser("OWNER", merchantA, true);

      databaseMocks.findUser.mockResolvedValue(user);

      const response = await unlinkRequest(
        merchantA,
        tokenFor(user)
      );

      expect(response.status).toBe(403);
      expect(unlinkServiceMocks.unlink)
        .not.toHaveBeenCalled();
    });

    it("rejects stale authentication", async () => {
      const user = makeUser();

      databaseMocks.findUser.mockResolvedValue({
        ...user,
        tokenVersion: 1
      });

      const response = await unlinkRequest(
        merchantA,
        tokenFor(user)
      );

      expect(response.status).toBe(401);
      expect(unlinkServiceMocks.unlink)
        .not.toHaveBeenCalled();
    });

    it.each([
      [
        "UNSAFE_IN_FLIGHT",
        409,
        "Billing Telegram unlink cannot complete while deliveries require safety review"
      ],
      [
        "NOT_ELIGIBLE",
        403,
        "Billing Telegram unlink not permitted"
      ]
    ] as const)(
      "maps unlink rejection %s to HTTP %s",
      async (reason, status, error) => {
        const user = makeUser();

        databaseMocks.findUser.mockResolvedValue(user);
        unlinkServiceMocks.unlink.mockResolvedValue({
          ok: false,
          reason
        });

        const response = await unlinkRequest(
          merchantA,
          tokenFor(user)
        );

        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({
          error
        });

        expect(unlinkServiceMocks.unlink)
          .toHaveBeenCalledExactlyOnceWith(
            merchantA,
            user.id,
            user.tokenVersion
          );

        expect(response.headers.get("cache-control"))
          .toBe("no-store");
      }
    );

    it("sanitizes unexpected unlink service errors", async () => {
      const user = makeUser();

      databaseMocks.findUser.mockResolvedValue(user);
      unlinkServiceMocks.unlink.mockRejectedValue(
        new Error("internal-database-detail")
      );

      const response = await unlinkRequest(
        merchantA,
        tokenFor(user)
      );

      expect(response.status).toBe(500);

      const body = await response.json();

      expect(body).toEqual({
        error: "Failed to unlink billing Telegram"
      });

      expect(JSON.stringify(body))
        .not.toContain("internal-database-detail");

      expect(response.headers.get("cache-control"))
        .toBe("no-store");
    });
  });
  });
});
