import {
  createHash
} from "node:crypto";

import {
  createPlatformAuthToken
} from "../src/services/platform-auth.js";

import type {
  Server
} from "node:http";

import platformAdminRouter
  from "../src/routes/platform-admin.js";

import express from "express";

import {
  MerchantInvoiceStatus,
  MerchantSettlementStatus,
  MerchantUserRole,
  Prisma,
  prisma
} from "@ethio-commerce/database";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

const storageMocks =
  vi.hoisted(() => {
    class SettlementReceiptNotFoundError extends Error {
      constructor() {
        super(
          "Settlement receipt evidence is not available"
        );

        this.name =
          "SettlementReceiptNotFoundError";
      }
    }

    return {
      uploadSettlementReceipt:
        vi.fn(),
      deleteSettlementReceipt:
        vi.fn(),
      getSettlementReceipt:
        vi.fn(),
      SettlementReceiptNotFoundError
    };
  });

vi.mock(
  "../src/services/storage.js",
  () => ({
    getMaxImageSizeBytes:
      () =>
        5 * 1024 * 1024,

    isAllowedImageType:
      (mimeType: string) =>
        [
          "image/jpeg",
          "image/png",
          "image/webp"
        ].includes(
          mimeType
        ),

    uploadSettlementReceipt:
      storageMocks.uploadSettlementReceipt,

    deleteSettlementReceipt:
      storageMocks.deleteSettlementReceipt,

    getSettlementReceipt:
      storageMocks.getSettlementReceipt,

    SettlementReceiptNotFoundError:
      storageMocks.SettlementReceiptNotFoundError

  })
);

import merchantSettlementsRouter
  from "../src/routes/merchant-settlements.js";

import {
  createAuthToken
} from "../src/services/auth.js";

const testPrefix =
  "settlement-receipt-upload";

let server:
  Server | null = null;

let apiBaseUrl =
  "";

async function cleanup():
  Promise<void> {
  const merchants =
    await prisma.merchant.findMany({
      where: {
        name: {
          startsWith:
            testPrefix
        }
      },
      select: {
        id: true
      }
    });

  const merchantIds =
    merchants.map(
      (merchant) =>
        merchant.id
    );

  await prisma.platformUser.deleteMany({
    where: {
      email: {
        startsWith:
          `${testPrefix}-platform-`
      }
    }
  });

  if (
    merchantIds.length === 0
  ) {
    return;
  }

  await prisma.merchantSettlement.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.auditLog.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantInvoiceItem.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantInvoice.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantUser.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchant.deleteMany({
    where: {
      id: {
        in:
          merchantIds
      }
    }
  });
}

async function createFixture(
  suffix: string,
  role:
    MerchantUserRole =
    MerchantUserRole.OWNER
) {
  const merchant =
    await prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-${suffix}`,
        currency:
          "ETB"
      }
    });

  const user =
    await prisma.merchantUser.create({
      data: {
        merchantId:
          merchant.id,
        email:
          `${testPrefix}-${suffix}@example.test`,
        passwordHash:
          "test-password-hash",
        displayName:
          `Test ${role}`,
        role,
        tokenVersion:
          0
      }
    });

  const invoice =
    await prisma.merchantInvoice.create({
      data: {
        merchantId:
          merchant.id,
        invoiceNumber:
          `INV-RECEIPT-${suffix}`,
        periodStart:
          new Date(
            "2026-09-01T00:00:00.000Z"
          ),
        periodEnd:
          new Date(
            "2026-10-01T00:00:00.000Z"
          ),
        subscriptionAmount:
          new Prisma.Decimal(
            "500.00"
          ),
        commissionAmount:
          new Prisma.Decimal(
            "50.00"
          ),
        totalAmount:
          new Prisma.Decimal(
            "550.00"
          ),
        currency:
          "ETB",
        status:
          MerchantInvoiceStatus.OPEN,
        openedAt:
          new Date(
            "2026-10-01T00:00:00.000Z"
          )
      }
    });

  const token =
    createAuthToken({
      id:
        user.id,
      merchantId:
        merchant.id,
      role:
        user.role,
      tokenVersion:
        user.tokenVersion
    });

  return {
    merchant,
    user,
    invoice,
    token
  };
}

async function createPlatformFixture(
  suffix: string
) {
  const user =
    await prisma.platformUser.create({
      data: {
        email:
          `${testPrefix}-platform-${suffix}@example.test`,
        passwordHash:
          "test-password-hash",
        displayName:
          `Platform Test ${suffix}`,
        role: "ADMIN",
        tokenVersion:
          0
      }
    });

  const token =
    createPlatformAuthToken({
      id:
        user.id,
      tokenVersion:
        user.tokenVersion
    });

  return {
    user,
    token
  };
}

function createSettlementForm(
  invoiceId: string,
  suffix: string,
  receiptContents:
    string =
    "test-receipt-image",
  receiptType:
    string =
    "image/png"
): FormData {
  const form =
    new FormData();

  form.set(
    "invoiceId",
    invoiceId
  );

  form.set(
    "provider",
    "TELEBIRR"
  );

  form.set(
    "amount",
    "550.00"
  );

  form.set(
    "currency",
    "ETB"
  );

  form.set(
    "idempotencyKey",
    `receipt-${suffix}`
  );

  form.set(
    "transactionReference",
    `TX-RECEIPT-${suffix}`
  );

  form.set(
    "receipt",
    new Blob(
      [
        receiptContents
      ],
      {
        type:
          receiptType
      }
    ),
    receiptType ===
      "image/jpeg"
      ? "receipt.jpg"
      : receiptType ===
        "image/webp"
        ? "receipt.webp"
        : "receipt.png"
  );

  return form;
}

async function postSettlementReceipt(
  merchantId: string,
  token: string,
  form: FormData
) {
  return fetch(
    `${apiBaseUrl}/merchants/${merchantId}/billing/settlements`,
    {
      method:
        "POST",
      headers: {
        authorization:
          `Bearer ${token}`
      },
      body:
        form
    }
  );
}

async function getSettlementEvidence(
  merchantId: string,
  settlementId: string,
  token?: string
) {
  const headers:
    Record<string, string> = {};

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  return fetch(
    `${apiBaseUrl}/merchants/${merchantId}/billing/settlements/${settlementId}/evidence`,
    {
      method:
        "GET",
      headers
    }
  );
}

async function getPlatformSettlementEvidence(
  merchantId: string,
  settlementId: string,
  token?: string
) {
  const headers:
    Record<string, string> = {};

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  return fetch(
    `${apiBaseUrl}/platform/merchants/${merchantId}/billing/settlements/${settlementId}/evidence`,
    {
      method:
        "GET",
      headers
    }
  );
}

beforeAll(
  async () => {
    const app =
      express();

    app.use(
      express.json()
    );

    app.use(
      "/merchants",
      merchantSettlementsRouter
    );

    app.use(
      "/platform",
      platformAdminRouter
    );

    await new Promise<void>(
      (
        resolve,
        reject
      ) => {
        server =
          app.listen(
            0,
            "127.0.0.1",
            () => {
              resolve();
            }
          );

        server.once(
          "error",
          reject
        );
      }
    );

    const address =
      server?.address();

    if (
      !address ||
      typeof address ===
      "string"
    ) {
      throw new Error(
        "Failed to start test API server"
      );
    }

    apiBaseUrl =
      `http://127.0.0.1:${address.port}`;
  }
);

beforeEach(
  async () => {
    await cleanup();

    storageMocks.uploadSettlementReceipt
      .mockReset();

    storageMocks.deleteSettlementReceipt
      .mockReset();

    storageMocks.getSettlementReceipt
      .mockReset();

    storageMocks.uploadSettlementReceipt
      .mockResolvedValue(
        undefined
      );

    storageMocks.deleteSettlementReceipt
      .mockResolvedValue(
        undefined
      );

    storageMocks.getSettlementReceipt
      .mockResolvedValue({
        buffer:
          Buffer.from(
            "private-settlement-receipt"
          ),
        contentType:
          "image/png",
        contentLength:
          Buffer.byteLength(
            "private-settlement-receipt"
          )
      });
  }
);

afterAll(
  async () => {
    await cleanup();

    if (server) {
      await new Promise<void>(
        (
          resolve,
          reject
        ) => {
          server!.close(
            (error) => {
              if (error) {
                reject(
                  error
                );
                return;
              }

              resolve();
            }
          );
        }
      );
    }

    await prisma.$disconnect();
  }
);

describe(
  "merchant settlement receipt upload",
  () => {
    it(
      "stores server-controlled receipt evidence while keeping the invoice open",
      async () => {
        const fixture =
          await createFixture(
            "success"
          );

        const receiptContents =
          "receipt-success";

        const response =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "SUCCESS",
              receiptContents
            )
          );

        expect(
          storageMocks.uploadSettlementReceipt
        ).toHaveBeenCalledTimes(
          1
        );

        const uploadCall =
          storageMocks.uploadSettlementReceipt
            .mock.calls[0];

        const objectKey =
          uploadCall[0] as string;

        expect(
          objectKey
        ).toContain(
          `merchants/${fixture.merchant.id}/settlements/`
        );

        expect(
          objectKey
        ).not.toContain(
          fixture.invoice.id
        );

        expect(
          objectKey
        ).not.toContain(
          "receipt-SUCCESS"
        );

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          settlement.verifiedAt
        ).toBeNull();

        expect(
          settlement.receiptUrl
        ).toBeNull();

        expect(
          settlement.receiptMetadata
        ).toMatchObject({
          receivedVia:
            "MERCHANT_DASHBOARD",
          contentType:
            "image/png",
          size:
            Buffer.byteLength(
              receiptContents
            ),
          sha256:
            createHash(
              "sha256"
            )
              .update(
                receiptContents
              )
              .digest(
                "hex"
              ),
          objectKey
        });

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          invoice.paidAt
        ).toBeNull();

        expect(
          storageMocks.deleteSettlementReceipt
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "uses the same deterministic receipt object key for an identical idempotent replay",
      async () => {
        const fixture =
          await createFixture(
            "replay"
          );

        const firstResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "REPLAY",
              "same-receipt"
            )
          );

        expect(
          firstResponse.status
        ).toBe(201);

        const secondResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "REPLAY",
              "same-receipt"
            )
          );

        expect(
          secondResponse.status
        ).toBe(201);

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(1);

        expect(
          storageMocks.uploadSettlementReceipt
        ).toHaveBeenCalledTimes(
          2
        );

        const firstKey =
          storageMocks.uploadSettlementReceipt
            .mock.calls[0][0];

        const secondKey =
          storageMocks.uploadSettlementReceipt
            .mock.calls[1][0];

        expect(
          secondKey
        ).toBe(
          firstKey
        );

        expect(
          storageMocks.deleteSettlementReceipt
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "rejects a different receipt under the same idempotency key and cleans up the losing upload",
      async () => {
        const fixture =
          await createFixture(
            "different-file"
          );

        const firstResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "DIFFERENT",
              "first-receipt"
            )
          );

        expect(
          firstResponse.status
        ).toBe(201);

        const secondResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "DIFFERENT",
              "different-receipt"
            )
          );

        expect(
          secondResponse.status
        ).toBe(409);

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(1);

        const firstKey =
          storageMocks.uploadSettlementReceipt
            .mock.calls[0][0];

        const secondKey =
          storageMocks.uploadSettlementReceipt
            .mock.calls[1][0];

        expect(
          secondKey
        ).not.toBe(
          firstKey
        );

        expect(
          storageMocks.deleteSettlementReceipt
        ).toHaveBeenCalledTimes(
          1
        );

        expect(
          storageMocks.deleteSettlementReceipt
        ).toHaveBeenCalledWith(
          secondKey
        );

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          invoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "rejects unsupported receipt types before storage or settlement creation",
      async () => {
        const fixture =
          await createFixture(
            "bad-type"
          );

        const form =
          createSettlementForm(
            fixture.invoice.id,
            "BADTYPE"
          );

        form.set(
          "receipt",
          new Blob(
            [
              "not-an-image"
            ],
            {
              type:
                "text/plain"
            }
          ),
          "receipt.txt"
        );

        const response =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            form
          );

        expect(
          response.status
        ).toBe(400);

        expect(
          storageMocks.uploadSettlementReceipt
        ).not.toHaveBeenCalled();

        expect(
          storageMocks.deleteSettlementReceipt
        ).not.toHaveBeenCalled();

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "blocks cross-merchant receipt submission before storage",
      async () => {
        const owner =
          await createFixture(
            "cross-owner"
          );

        const target =
          await createFixture(
            "cross-target"
          );

        const response =
          await postSettlementReceipt(
            target.merchant.id,
            owner.token,
            createSettlementForm(
              target.invoice.id,
              "CROSS"
            )
          );

        expect(
          response.status
        ).toBe(403);

        expect(
          storageMocks.uploadSettlementReceipt
        ).not.toHaveBeenCalled();

        expect(
          storageMocks.deleteSettlementReceipt
        ).not.toHaveBeenCalled();

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                target.merchant.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "allows an OWNER to read private settlement evidence for their own settlement",
      async () => {
        const fixture =
          await createFixture(
            "read-own"
          );

        const receiptContents =
          "read-own-receipt";

        const submitResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "READ-OWN",
              receiptContents
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        const receiptMetadata =
          settlement.receiptMetadata as
          Prisma.JsonObject;

        const objectKey =
          receiptMetadata.objectKey;

        expect(
          typeof objectKey
        ).toBe("string");

        storageMocks.getSettlementReceipt
          .mockResolvedValueOnce({
            buffer:
              Buffer.from(
                receiptContents
              ),
            contentType:
              "image/png",
            contentLength:
              Buffer.byteLength(
                receiptContents
              )
          });

        const response =
          await getSettlementEvidence(
            fixture.merchant.id,
            settlement.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(200);

        expect(
          response.headers.get(
            "content-type"
          )
        ).toContain(
          "image/png"
        );

        expect(
          response.headers.get(
            "cache-control"
          )
        ).toBe(
          "private, no-store"
        );

        expect(
          Buffer.from(
            await response.arrayBuffer()
          ).toString()
        ).toBe(
          receiptContents
        );

        expect(
          storageMocks.getSettlementReceipt
        ).toHaveBeenCalledTimes(
          1
        );

        expect(
          storageMocks.getSettlementReceipt
        ).toHaveBeenCalledWith(
          objectKey
        );

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          settlement.verifiedAt
        ).toBeNull();

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          invoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "blocks unauthenticated access to private settlement evidence before storage",
      async () => {
        const fixture =
          await createFixture(
            "read-unauthenticated"
          );

        const submitResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "READ-UNAUTHENTICATED"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        storageMocks.getSettlementReceipt
          .mockClear();

        const response =
          await getSettlementEvidence(
            fixture.merchant.id,
            settlement.id
          );

        expect(
          response.status
        ).toBe(401);

        expect(
          storageMocks.getSettlementReceipt
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "blocks another merchant from reading private settlement evidence before storage",
      async () => {
        const merchantA =
          await createFixture(
            "read-merchant-a"
          );

        const merchantB =
          await createFixture(
            "read-merchant-b"
          );

        const submitResponse =
          await postSettlementReceipt(
            merchantA.merchant.id,
            merchantA.token,
            createSettlementForm(
              merchantA.invoice.id,
              "READ-MERCHANT-A"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                merchantA.merchant.id,
              invoiceId:
                merchantA.invoice.id
            }
          });

        storageMocks.getSettlementReceipt
          .mockClear();

        const response =
          await getSettlementEvidence(
            merchantA.merchant.id,
            settlement.id,
            merchantB.token
          );

        expect(
          response.status
        ).toBe(403);

        expect(
          storageMocks.getSettlementReceipt
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "returns 404 for a nonexistent settlement without reading private storage",
      async () => {
        const fixture =
          await createFixture(
            "read-missing"
          );

        storageMocks.getSettlementReceipt
          .mockClear();

        const response =
          await getSettlementEvidence(
            fixture.merchant.id,
            "missing-settlement-id",
            fixture.token
          );

        expect(
          response.status
        ).toBe(404);

        expect(
          storageMocks.getSettlementReceipt
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "returns 404 when merchant settlement receipt metadata points to missing private storage evidence",
      async () => {
        const fixture =
          await createFixture(
            "read-missing-storage-object"
          );

        const submitResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "READ-MISSING-STORAGE-OBJECT"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        storageMocks.getSettlementReceipt
          .mockRejectedValueOnce(
            new storageMocks.SettlementReceiptNotFoundError()
          );

        const response =
          await getSettlementEvidence(
            fixture.merchant.id,
            settlement.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(404);

        const responseBody =
          await response.json() as {
            error?: string;
          };

        expect(
          responseBody.error
        ).toBe(
          "Settlement receipt evidence is not available"
        );

        expect(
          storageMocks.getSettlementReceipt
        ).toHaveBeenCalledTimes(1);

        const unchangedSettlement =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                settlement.id
            }
          });

        const unchangedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          unchangedSettlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          unchangedSettlement.verifiedAt
        ).toBeNull();

        expect(
          unchangedInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          unchangedInvoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "allows a platform administrator to read private settlement evidence",
      async () => {
        const fixture =
          await createFixture(
            "platform-read"
          );

        const platform =
          await createPlatformFixture(
            "platform-read"
          );

        const submitResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "PLATFORM-READ",
              "platform-read-receipt"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        const receiptMetadata =
          settlement.receiptMetadata as
          Prisma.JsonObject;

        const objectKey =
          receiptMetadata.objectKey;

        expect(
          typeof objectKey
        ).toBe("string");

        storageMocks.getSettlementReceipt
          .mockClear();

        const response =
          await getPlatformSettlementEvidence(
            fixture.merchant.id,
            settlement.id,
            platform.token
          );

        expect(
          response.status
        ).toBe(200);

        expect(
          response.headers.get(
            "content-type"
          )
        ).toContain(
          "image/png"
        );

        expect(
          response.headers.get(
            "cache-control"
          )
        ).toBe(
          "private, no-store"
        );

        expect(
          Buffer.from(
            await response.arrayBuffer()
          ).toString()
        ).toBe(
          "private-settlement-receipt"
        );

        expect(
          storageMocks.getSettlementReceipt
        ).toHaveBeenCalledTimes(
          1
        );

        expect(
          storageMocks.getSettlementReceipt
        ).toHaveBeenCalledWith(
          objectKey
        );

        const unchangedSettlement =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                settlement.id
            }
          });

        const unchangedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          unchangedSettlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          unchangedSettlement.verifiedAt
        ).toBeNull();

        expect(
          unchangedInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          unchangedInvoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "returns 404 when platform settlement receipt metadata points to missing private storage evidence",
      async () => {
        const fixture =
          await createFixture(
            "platform-read-missing-storage-object"
          );

        const platform =
          await createPlatformFixture(
            "platform-read-missing-storage-object"
          );

        const submitResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "PLATFORM-READ-MISSING-STORAGE-OBJECT"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        storageMocks.getSettlementReceipt
          .mockRejectedValueOnce(
            new storageMocks.SettlementReceiptNotFoundError()
          );

        const response =
          await getPlatformSettlementEvidence(
            fixture.merchant.id,
            settlement.id,
            platform.token
          );

        expect(
          response.status
        ).toBe(404);

        const responseBody =
          await response.json() as {
            error?: string;
          };

        expect(
          responseBody.error
        ).toBe(
          "Settlement receipt evidence is not available"
        );

        expect(
          storageMocks.getSettlementReceipt
        ).toHaveBeenCalledTimes(1);

        const unchangedSettlement =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                settlement.id
            }
          });

        const unchangedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          unchangedSettlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          unchangedSettlement.verifiedAt
        ).toBeNull();

        expect(
          unchangedInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          unchangedInvoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "returns 500 when merchant settlement receipt storage fails unexpectedly",
      async () => {
        const fixture =
          await createFixture(
            "read-storage-failure"
          );

        const submitResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "READ-STORAGE-FAILURE"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        storageMocks.getSettlementReceipt
          .mockRejectedValueOnce(
            new Error(
              "Simulated private storage failure"
            )
          );

        const response =
          await getSettlementEvidence(
            fixture.merchant.id,
            settlement.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(500);

        const responseBody =
          await response.json() as {
            error?: string;
          };

        expect(
          responseBody.error
        ).toBe(
          "Failed to read settlement receipt evidence"
        );

        expect(
          storageMocks.getSettlementReceipt
        ).toHaveBeenCalledTimes(1);
      }
    );

    it(
      "blocks a merchant OWNER from using the platform settlement evidence endpoint before storage",
      async () => {
        const fixture =
          await createFixture(
            "platform-read-merchant-token"
          );

        const submitResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "PLATFORM-READ-MERCHANT"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        storageMocks.getSettlementReceipt
          .mockClear();

        const response =
          await getPlatformSettlementEvidence(
            fixture.merchant.id,
            settlement.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(403);

        const responseBody =
          await response.json() as {
            error?: string;
          };

        expect(
          responseBody.error
        ).toBe(
          "Merchant accounts are not authorized to access platform administration"
        );

        expect(
          storageMocks.getSettlementReceipt
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "blocks unauthenticated platform settlement evidence access before storage",
      async () => {
        const fixture =
          await createFixture(
            "platform-read-unauthenticated"
          );

        const submitResponse =
          await postSettlementReceipt(
            fixture.merchant.id,
            fixture.token,
            createSettlementForm(
              fixture.invoice.id,
              "PLATFORM-READ-UNAUTHENTICATED"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        storageMocks.getSettlementReceipt
          .mockClear();

        const response =
          await getPlatformSettlementEvidence(
            fixture.merchant.id,
            settlement.id
          );

        expect(
          response.status
        ).toBe(401);

        expect(
          storageMocks.getSettlementReceipt
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "returns 404 for a platform settlement evidence merchant mismatch without reading private storage",
      async () => {
        const merchantA =
          await createFixture(
            "platform-read-a"
          );

        const merchantB =
          await createFixture(
            "platform-read-b"
          );

        const platform =
          await createPlatformFixture(
            "platform-read-mismatch"
          );

        const submitResponse =
          await postSettlementReceipt(
            merchantA.merchant.id,
            merchantA.token,
            createSettlementForm(
              merchantA.invoice.id,
              "PLATFORM-READ-MISMATCH"
            )
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                merchantA.merchant.id,
              invoiceId:
                merchantA.invoice.id
            }
          });

        storageMocks.getSettlementReceipt
          .mockClear();

        const response =
          await getPlatformSettlementEvidence(
            merchantB.merchant.id,
            settlement.id,
            platform.token
          );

        expect(
          response.status
        ).toBe(404);

        expect(
          storageMocks.getSettlementReceipt
        ).not.toHaveBeenCalled();
      }
    );
  }
);
