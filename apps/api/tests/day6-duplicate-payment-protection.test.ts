import { afterAll, describe, expect, it } from "vitest";
import {
  prisma,
  PaymentProvider,
  PaymentStatus,
  OrderStatus,
  ProductStatus,
} from "@ethio-commerce/database";

describe("Day 6 - duplicate payment protection", () => {
  const suffix = `day6-${Date.now()}`;

  let merchantId: string;
  let customerId: string;

  const orders: string[] = [];
  const payments: string[] = [];
  const products: string[] = [];

  afterAll(async () => {
    if (merchantId) {
      await prisma.payment.deleteMany({
        where: {
          id: {
            in: payments,
          },
        },
      });

      await prisma.orderItem.deleteMany({
        where: {
          orderId: {
            in: orders,
          },
        },
      });

      await prisma.order.deleteMany({
        where: {
          id: {
            in: orders,
          },
        },
      });

      await prisma.product.deleteMany({
        where: {
          id: {
            in: products,
          },
        },
      });

      if (customerId) {
        await prisma.customer.deleteMany({
          where: {
            id: customerId,
          },
        });
      }

      await prisma.merchant.deleteMany({
        where: {
          id: merchantId,
        },
      });
    }

    await prisma.$disconnect();
  });

  async function createOrder(
    orderNumber: string,
    total: number,
    productName: string,
  ) {
    const product = await prisma.product.create({
      data: {
        merchantId,
        name: `${productName} ${suffix}`,
        price: total,
        currency: "ETB",
        stock: 10,
        status: ProductStatus.ACTIVE,
      },
    });

    products.push(product.id);

    const order = await prisma.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber,
        status: OrderStatus.PENDING_PAYMENT,
        currency: "ETB",
        subtotal: total,
        total,
        items: {
          create: {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            unitPrice: total,
            lineTotal: total,
          },
        },
      },
    });

    orders.push(order.id);

    return {
      order,
      product,
    };
  }

  async function createPayment(
    orderId: string,
    amount: number,
    transactionReference: string,
    receiptUrl: string,
  ) {
    const payment = await prisma.payment.create({
      data: {
        merchantId,
        orderId,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount,
        currency: "ETB",
        transactionReference,
        receiptUrl,
        receiptMetadata: {
          receiptId: `DAY6-${transactionReference}`,
          orderId,
        },
      },
    });

    payments.push(payment.id);

    await prisma.order.update({
      where: {
        id: orderId,
      },
      data: {
        status: OrderStatus.PAYMENT_REVIEW,
      },
    });

    return payment;
  }

  /*
   * --------------------------------------------------
   * TEST FIXTURES
   * --------------------------------------------------
   */
  it("creates an isolated merchant and customer", async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: `Day 6 Test Merchant ${suffix}`,
        currency: "ETB",
      },
    });

    merchantId = merchant.id;

    const customer = await prisma.customer.create({
      data: {
        merchantId,
        name: `Day 6 Test Customer ${suffix}`,
        telegramChatId: `day6-chat-${Date.now()}`,
        telegramUserId: `day6-user-${Date.now()}`,
      },
    });

    customerId = customer.id;

    expect(merchantId).toBeDefined();
    expect(customerId).toBeDefined();
  });

  /*
   * --------------------------------------------------
   * SAME TRANSACTION REFERENCE
   * --------------------------------------------------
   */
  it("rejects reuse of the same transaction reference", async () => {
    const { order } = await createOrder(
      `DAY6-SAME-REF-${Date.now()}`,
      100,
      "Day 6 Same Reference Product",
    );

    const reference = `DAY6-TRANSACTION-${Date.now()}`;

    const firstPayment = await createPayment(
      order.id,
      100,
      reference,
      `receipts/${merchantId}/${order.id}/first.jpg`,
    );

    expect(firstPayment.status).toBe(
      PaymentStatus.REVIEW_REQUIRED,
    );

    await expect(
      prisma.payment.create({
        data: {
          merchantId,
          orderId: order.id,
          provider: PaymentProvider.TELEBIRR,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: 100,
          currency: "ETB",
          transactionReference: reference,
          receiptUrl:
            `receipts/${merchantId}/${order.id}/duplicate.jpg`,
        },
      }),
    ).rejects.toThrow();

    const paymentsForReference =
      await prisma.payment.findMany({
        where: {
          provider: PaymentProvider.TELEBIRR,
          transactionReference: reference,
        },
      });

    expect(paymentsForReference).toHaveLength(1);
    expect(paymentsForReference[0].id).toBe(
      firstPayment.id,
    );
  });

  /*
   * --------------------------------------------------
   * SAME REFERENCE / DIFFERENT ORDER
   * --------------------------------------------------
   *
   * This is the critical financial-event test.
   *
   * A transaction reference identifies the external
   * financial event, so it must not become reusable
   * simply because somebody submits it against
   * another order.
   */
  it("rejects the same transaction reference on a different order", async () => {
    const orderA = await createOrder(
      `DAY6-CROSS-ORDER-A-${Date.now()}`,
      100,
      "Day 6 Cross Order A",
    );

    const orderB = await createOrder(
      `DAY6-CROSS-ORDER-B-${Date.now()}`,
      100,
      "Day 6 Cross Order B",
    );

    const reference = `DAY6-CROSS-ORDER-TXN-${Date.now()}`;

    const paymentA = await createPayment(
      orderA.order.id,
      100,
      reference,
      `receipts/${merchantId}/${orderA.order.id}/receipt.jpg`,
    );

    expect(paymentA.orderId).toBe(orderA.order.id);

    await expect(
      createPayment(
        orderB.order.id,
        100,
        reference,
        `receipts/${merchantId}/${orderB.order.id}/receipt.jpg`,
      ),
    ).rejects.toThrow();

    const matchingPayments =
      await prisma.payment.findMany({
        where: {
          provider: PaymentProvider.TELEBIRR,
          transactionReference: reference,
        },
      });

    expect(matchingPayments).toHaveLength(1);
    expect(matchingPayments[0].orderId).toBe(
      orderA.order.id,
    );
  });

  /*
   * --------------------------------------------------
   * SAME RECEIPT / SAME FINANCIAL EVENT
   * --------------------------------------------------
   *
   * receiptUrl itself is not globally unique because
   * storage URLs are evidence locations, not the
   * financial identity.
   *
   * The financial identity is protected by the
   * provider + transaction reference.
   *
   * Therefore reusing the same receipt with the
   * same extracted transaction reference must fail.
   */
  it("does not allow the same receipt financial event to create a second payment", async () => {
    const { order } = await createOrder(
      `DAY6-RECEIPT-${Date.now()}`,
      150,
      "Day 6 Receipt Product",
    );

    const reference = `DAY6-RECEIPT-TXN-${Date.now()}`;
    const receiptUrl =
      `receipts/${merchantId}/${order.id}/same-receipt.jpg`;

    const payment = await createPayment(
      order.id,
      150,
      reference,
      receiptUrl,
    );

    expect(payment.receiptUrl).toBe(receiptUrl);

    await expect(
      prisma.payment.create({
        data: {
          merchantId,
          orderId: order.id,
          provider: PaymentProvider.TELEBIRR,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: 150,
          currency: "ETB",
          transactionReference: reference,
          receiptUrl,
          receiptMetadata: {
            duplicateReceiptAttempt: true,
          },
        },
      }),
    ).rejects.toThrow();

    const persisted =
      await prisma.payment.findMany({
        where: {
          provider: PaymentProvider.TELEBIRR,
          transactionReference: reference,
        },
      });

    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(payment.id);
  });

  /*
   * --------------------------------------------------
   * SAME PAYMENT
   * --------------------------------------------------
   */
  it("does not allow the same payment to be verified twice", async () => {
    const { order, product } = await createOrder(
      `DAY6-SAME-PAYMENT-${Date.now()}`,
      200,
      "Day 6 Same Payment Product",
    );

    const payment = await createPayment(
      order.id,
      200,
      `DAY6-SAME-PAYMENT-TXN-${Date.now()}`,
      `receipts/${merchantId}/${order.id}/payment.jpg`,
    );

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          merchantId,
          status: PaymentStatus.REVIEW_REQUIRED,
        },
        data: {
          status: PaymentStatus.VERIFIED,
          verifiedAt: new Date(),
        },
      });

      expect(claimed.count).toBe(1);

      await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: OrderStatus.PAID,
        },
      });

      await tx.product.updateMany({
        where: {
          id: product.id,
          merchantId,
          stock: {
            gte: 1,
          },
        },
        data: {
          stock: {
            decrement: 1,
          },
        },
      });
    });

    const secondClaim =
      await prisma.payment.updateMany({
        where: {
          id: payment.id,
          merchantId,
          status: PaymentStatus.REVIEW_REQUIRED,
        },
        data: {
          status: PaymentStatus.VERIFIED,
          verifiedAt: new Date(),
        },
      });

    expect(secondClaim.count).toBe(0);

    const persistedPayment =
      await prisma.payment.findUnique({
        where: {
          id: payment.id,
        },
      });

    expect(persistedPayment!.status).toBe(
      PaymentStatus.VERIFIED,
    );

    const persistedOrder =
      await prisma.order.findUnique({
        where: {
          id: order.id,
        },
      });

    expect(persistedOrder!.status).toBe(
      OrderStatus.PAID,
    );

    const persistedProduct =
      await prisma.product.findUnique({
        where: {
          id: product.id,
        },
      });

    expect(persistedProduct!.stock).toBe(9);
  });

  /*
   * --------------------------------------------------
   * SAME ORDER
   * --------------------------------------------------
   */
  it("does not allow the same transaction reference to be reused by another payment for the same order", async () => {
    const { order } = await createOrder(
      `DAY6-SAME-ORDER-${Date.now()}`,
      250,
      "Day 6 Same Order Product",
    );

    const reference = `DAY6-SAME-ORDER-TXN-${Date.now()}`;

    const original = await createPayment(
      order.id,
      250,
      reference,
      `receipts/${merchantId}/${order.id}/original.jpg`,
    );

    await expect(
      createPayment(
        order.id,
        250,
        reference,
        `receipts/${merchantId}/${order.id}/second.jpg`,
      ),
    ).rejects.toThrow();

    const orderPayments =
      await prisma.payment.findMany({
        where: {
          orderId: order.id,
        },
      });

    expect(orderPayments).toHaveLength(1);
    expect(orderPayments[0].id).toBe(original.id);
  });

  /*
   * --------------------------------------------------
   * DIFFERENT ORDER / DIFFERENT FINANCIAL EVENT
   * --------------------------------------------------
   */
  it("allows a genuinely different transaction on a different order", async () => {
    const orderA = await createOrder(
      `DAY6-INDEPENDENT-A-${Date.now()}`,
      300,
      "Day 6 Independent A",
    );

    const orderB = await createOrder(
      `DAY6-INDEPENDENT-B-${Date.now()}`,
      400,
      "Day 6 Independent B",
    );

    const paymentA = await createPayment(
      orderA.order.id,
      300,
      `DAY6-INDEPENDENT-TXN-A-${Date.now()}`,
      `receipts/${merchantId}/${orderA.order.id}/A.jpg`,
    );

    const paymentB = await createPayment(
      orderB.order.id,
      400,
      `DAY6-INDEPENDENT-TXN-B-${Date.now()}`,
      `receipts/${merchantId}/${orderB.order.id}/B.jpg`,
    );

    expect(paymentA.id).not.toBe(paymentB.id);
    expect(paymentA.orderId).toBe(orderA.order.id);
    expect(paymentB.orderId).toBe(orderB.order.id);

    expect(
      paymentA.transactionReference,
    ).not.toBe(
      paymentB.transactionReference,
    );

    const persisted =
      await prisma.payment.findMany({
        where: {
          id: {
            in: [paymentA.id, paymentB.id],
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });

    expect(persisted).toHaveLength(2);
  });

  /*
   * --------------------------------------------------
   * ORIGINAL PAYMENT INTEGRITY
   * --------------------------------------------------
   */
  it("keeps the original payment unchanged after duplicate attempts", async () => {
    const { order } = await createOrder(
      `DAY6-INTEGRITY-${Date.now()}`,
      500,
      "Day 6 Integrity Product",
    );

    const reference = `DAY6-INTEGRITY-TXN-${Date.now()}`;
    const receiptUrl =
      `receipts/${merchantId}/${order.id}/original.jpg`;

    const original = await createPayment(
      order.id,
      500,
      reference,
      receiptUrl,
    );

    await expect(
      prisma.payment.create({
        data: {
          merchantId,
          orderId: order.id,
          provider: PaymentProvider.TELEBIRR,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: 500,
          currency: "ETB",
          transactionReference: reference,
          receiptUrl:
            `receipts/${merchantId}/${order.id}/attacker.jpg`,
          receiptMetadata: {
            attemptedReuse: true,
          },
        },
      }),
    ).rejects.toThrow();

    const persisted =
      await prisma.payment.findUnique({
        where: {
          id: original.id,
        },
      });

    expect(persisted).toBeDefined();
    expect(persisted!.status).toBe(
      PaymentStatus.REVIEW_REQUIRED,
    );
    expect(persisted!.transactionReference).toBe(
      reference,
    );
    expect(persisted!.receiptUrl).toBe(
      receiptUrl,
    );
    expect(persisted!.orderId).toBe(order.id);
  });
});
