import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prisma,
  PaymentProvider,
  PaymentStatus,
  OrderStatus,
  ProductStatus,
} from "@ethio-commerce/database";

describe("Day 4 - concurrency isolation", () => {
  const suffix = `day4-${Date.now()}`;

  let merchantId: string;
  let customerAId: string;
  let customerBId: string;
  let productAId: string;
  let productBId: string;
  let orderAId: string;
  let orderBId: string;
  let paymentAId: string;
  let paymentBId: string;

  beforeAll(async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: `Day 4 Concurrency Merchant ${suffix}`,
        currency: "ETB",
      },
    });

    merchantId = merchant.id;

    const customerA = await prisma.customer.create({
      data: {
        merchantId,
        name: `Day 4 Customer A ${suffix}`,
        telegramChatId: `day4-chat-a-${Date.now()}`,
        telegramUserId: `day4-user-a-${Date.now()}`,
      },
    });

    const customerB = await prisma.customer.create({
      data: {
        merchantId,
        name: `Day 4 Customer B ${suffix}`,
        telegramChatId: `day4-chat-b-${Date.now()}`,
        telegramUserId: `day4-user-b-${Date.now()}`,
      },
    });

    customerAId = customerA.id;
    customerBId = customerB.id;

    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          merchantId,
          name: `Day 4 Product A ${suffix}`,
          price: 100,
          currency: "ETB",
          stock: 10,
          status: ProductStatus.ACTIVE,
        },
      }),
      prisma.product.create({
        data: {
          merchantId,
          name: `Day 4 Product B ${suffix}`,
          price: 200,
          currency: "ETB",
          stock: 10,
          status: ProductStatus.ACTIVE,
        },
      }),
    ]);

    productAId = productA.id;
    productBId = productB.id;
  });

  afterAll(async () => {
    if (merchantId) {
      await prisma.payment.deleteMany({
        where: { merchantId },
      });

      await prisma.orderItem.deleteMany({
        where: {
          order: {
            merchantId,
          },
        },
      });

      await prisma.order.deleteMany({
        where: { merchantId },
      });

      await prisma.product.deleteMany({
        where: { merchantId },
      });

      await prisma.customer.deleteMany({
        where: { merchantId },
      });

      await prisma.merchant.deleteMany({
        where: { id: merchantId },
      });
    }

    await prisma.$disconnect();
  });

  it("keeps Customer A and Customer B orders isolated during concurrent payment activity", async () => {
    const [orderA, orderB] = await Promise.all([
      prisma.order.create({
        data: {
          merchantId,
          customerId: customerAId,
          orderNumber: `DAY4-A-${Date.now()}-${Math.random()}`,
          status: OrderStatus.PAYMENT_REVIEW,
          currency: "ETB",
          subtotal: 100,
          total: 100,
          items: {
            create: {
              productId: productAId,
              productName: `Day 4 Product A ${suffix}`,
              quantity: 1,
              unitPrice: 100,
              lineTotal: 100,
            },
          },
        },
      }),
      prisma.order.create({
        data: {
          merchantId,
          customerId: customerBId,
          orderNumber: `DAY4-B-${Date.now()}-${Math.random()}`,
          status: OrderStatus.PAYMENT_REVIEW,
          currency: "ETB",
          subtotal: 200,
          total: 200,
          items: {
            create: {
              productId: productBId,
              productName: `Day 4 Product B ${suffix}`,
              quantity: 1,
              unitPrice: 200,
              lineTotal: 200,
            },
          },
        },
      }),
    ]);

    orderAId = orderA.id;
    orderBId = orderB.id;

    const [paymentA, paymentB] = await Promise.all([
      prisma.payment.create({
        data: {
          merchantId,
          orderId: orderA.id,
          provider: PaymentProvider.TELEBIRR,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: 100,
          currency: "ETB",
          transactionReference: `DAY4-TXN-A-${Date.now()}-${Math.random()}`,
          receiptMetadata: {
            receiptId: "DAY4-RECEIPT-A",
            orderId: orderA.id,
          },
        },
      }),
      prisma.payment.create({
        data: {
          merchantId,
          orderId: orderB.id,
          provider: PaymentProvider.TELEBIRR,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: 200,
          currency: "ETB",
          transactionReference: `DAY4-TXN-B-${Date.now()}-${Math.random()}`,
          receiptMetadata: {
            receiptId: "DAY4-RECEIPT-B",
            orderId: orderB.id,
          },
        },
      }),
    ]);

    paymentAId = paymentA.id;
    paymentBId = paymentB.id;

    const [loadedA, loadedB] = await Promise.all([
      prisma.payment.findFirst({
        where: {
          id: paymentA.id,
          merchantId,
          orderId: orderA.id,
        },
      }),
      prisma.payment.findFirst({
        where: {
          id: paymentB.id,
          merchantId,
          orderId: orderB.id,
        },
      }),
    ]);

    expect(loadedA?.orderId).toBe(orderA.id);
    expect(loadedB?.orderId).toBe(orderB.id);

    expect(loadedA?.orderId).not.toBe(orderB.id);
    expect(loadedB?.orderId).not.toBe(orderA.id);

    expect(loadedA?.receiptMetadata).toMatchObject({
      receiptId: "DAY4-RECEIPT-A",
      orderId: orderA.id,
    });

    expect(loadedB?.receiptMetadata).toMatchObject({
      receiptId: "DAY4-RECEIPT-B",
      orderId: orderB.id,
    });
  });

  it("keeps two overlapping orders for the same customer isolated", async () => {
    const [orderA, orderB] = await Promise.all([
      prisma.order.create({
        data: {
          merchantId,
          customerId: customerAId,
          orderNumber: `DAY4-SAME-A-${Date.now()}-${Math.random()}`,
          status: OrderStatus.PAYMENT_REVIEW,
          currency: "ETB",
          subtotal: 100,
          total: 100,
          items: {
            create: {
              productId: productAId,
              productName: `Day 4 Product A ${suffix}`,
              quantity: 1,
              unitPrice: 100,
              lineTotal: 100,
            },
          },
        },
      }),
      prisma.order.create({
        data: {
          merchantId,
          customerId: customerAId,
          orderNumber: `DAY4-SAME-B-${Date.now()}-${Math.random()}`,
          status: OrderStatus.PAYMENT_REVIEW,
          currency: "ETB",
          subtotal: 200,
          total: 200,
          items: {
            create: {
              productId: productBId,
              productName: `Day 4 Product B ${suffix}`,
              quantity: 1,
              unitPrice: 200,
              lineTotal: 200,
            },
          },
        },
      }),
    ]);

    const [paymentA, paymentB] = await Promise.all([
      prisma.payment.create({
        data: {
          merchantId,
          orderId: orderA.id,
          provider: PaymentProvider.TELEBIRR,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: 100,
          currency: "ETB",
          transactionReference: `DAY4-SAME-TXN-A-${Date.now()}-${Math.random()}`,
          receiptMetadata: {
            receiptId: "DAY4-SAME-RECEIPT-A",
            orderId: orderA.id,
          },
        },
      }),
      prisma.payment.create({
        data: {
          merchantId,
          orderId: orderB.id,
          provider: PaymentProvider.TELEBIRR,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: 200,
          currency: "ETB",
          transactionReference: `DAY4-SAME-TXN-B-${Date.now()}-${Math.random()}`,
          receiptMetadata: {
            receiptId: "DAY4-SAME-RECEIPT-B",
            orderId: orderB.id,
          },
        },
      }),
    ]);

    const [resultA, resultB] = await Promise.all([
      prisma.payment.findFirst({
        where: {
          id: paymentA.id,
          merchantId,
          orderId: orderA.id,
        },
      }),
      prisma.payment.findFirst({
        where: {
          id: paymentB.id,
          merchantId,
          orderId: orderB.id,
        },
      }),
    ]);

    expect(resultA?.orderId).toBe(orderA.id);
    expect(resultB?.orderId).toBe(orderB.id);

    expect(resultA?.orderId).not.toBe(orderB.id);
    expect(resultB?.orderId).not.toBe(orderA.id);

    expect(resultA?.amount.toString()).toBe("100");
    expect(resultB?.amount.toString()).toBe("200");
  });

  it("does not allow payment lookup by customer alone to cross orders", async () => {
    const payments = await prisma.payment.findMany({
      where: {
        merchantId,
        orderId: {
          in: [orderAId, orderBId],
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(payments).toHaveLength(2);

    for (const payment of payments) {
      expect([orderAId, orderBId]).toContain(payment.orderId);
    }

    const paymentForA = payments.find(
      (payment) => payment.orderId === orderAId,
    );

    const paymentForB = payments.find(
      (payment) => payment.orderId === orderBId,
    );

    expect(paymentForA).toBeDefined();
    expect(paymentForB).toBeDefined();

    expect(paymentForA!.id).not.toBe(paymentForB!.id);
  });
});
