import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prisma,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
  MerchantSubscriptionStatus,
  SubscriptionBillingInterval,
} from "@ethio-commerce/database";
import { createOrder } from "../src/tools/orders.js";

describe("Day 5 - order edge cases", () => {
  const suffix = `day5-${Date.now()}`;

  let merchantId: string;
  let customerId: string;

  const products: string[] = [];
  const orders: string[] = [];
  const payments: string[] = [];

  beforeAll(async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: `Day 5 Merchant ${suffix}`,
        currency: "ETB",
      },
    });

    merchantId = merchant.id;
const plan =
  await prisma.subscriptionPlan.create({
    data: {
      code:
        `${suffix}-plan`,
      name:
        `Day 5 Plan ${suffix}`,
      monthlyPrice:
        "500.00",
      annualPrice:
        "5000.00",
      currency:
        "ETB",
      commissionRate:
        "0.035000",
      isActive:
        true
    }
  });


await prisma.merchantSubscription.create({
  data: {
    merchantId,
    planId:
      plan.id,
    status:
      MerchantSubscriptionStatus.ACTIVE,
    billingInterval:
      SubscriptionBillingInterval.MONTHLY,
    priceSnapshot:
      "500.00",
    commissionRateSnapshot:
      "0.035000",
    currency:
      "ETB",
    currentPeriodStart:
      new Date(
        "2026-09-01T00:00:00.000Z"
      ),
    currentPeriodEnd:
      new Date(
        "2026-10-01T00:00:00.000Z"
      )
  }
});

    const customer = await prisma.customer.create({
      data: {
        merchantId,
        name: `Day 5 Customer ${suffix}`,
        telegramChatId: `day5-chat-${Date.now()}`,
        telegramUserId: `day5-user-${Date.now()}`,
      },
    });

    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({
      where: {
        id: { in: payments },
      },
    });

    await prisma.orderItem.deleteMany({
      where: {
        orderId: { in: orders },
      },
    });

    await prisma.order.deleteMany({
      where: {
        id: { in: orders },
      },
    });

    await prisma.product.deleteMany({
      where: {
        id: { in: products },
      },
    });

    if (customerId) {
      await prisma.customer.delete({
        where: { id: customerId },
      });
    }

    if (merchantId) {
  await prisma.merchantSubscription.deleteMany({
    where: {
      merchantId,
    },
  });

      await prisma.merchant.delete({
        where: { id: merchantId },
      });
    }

await prisma.subscriptionPlan.deleteMany({
  where: {
    code: `${suffix}-plan`,
  },
});

    await prisma.$disconnect();
  });

  async function createProduct(
    name: string,
    stock: number,
    price = 100,
  ) {
    const product = await prisma.product.create({
      data: {
        merchantId,
        name: `${name} ${suffix}`,
        price,
        currency: "ETB",
        stock,
        status: ProductStatus.ACTIVE,
      },
    });

    products.push(product.id);
    return product;
  }

  async function countCustomerOrders() {
    return prisma.order.count({
      where: {
        merchantId,
        customerId,
      },
    });
  }

  it("rejects an out-of-stock product without creating an order", async () => {
    const product = await createProduct("Out of Stock", 0);
    const before = await countCustomerOrders();

    await expect(
      createOrder(merchantId, customerId, product.id, 1),
    ).rejects.toThrow("Insufficient stock");

    const after = await countCustomerOrders();

    expect(after).toBe(before);

    const unchanged = await prisma.product.findUnique({
      where: { id: product.id },
    });

    expect(unchanged!.stock).toBe(0);
  });

  it("rejects invalid non-integer quantity", async () => {
    const product = await createProduct("Invalid Quantity", 10);
    const before = await countCustomerOrders();

    await expect(
      createOrder(merchantId, customerId, product.id, 1.5),
    ).rejects.toThrow("Quantity must be a positive integer");

    expect(await countCustomerOrders()).toBe(before);
  });

  it("rejects zero quantity", async () => {
    const product = await createProduct("Zero Quantity", 10);
    const before = await countCustomerOrders();

    await expect(
      createOrder(merchantId, customerId, product.id, 0),
    ).rejects.toThrow("Quantity must be a positive integer");

    expect(await countCustomerOrders()).toBe(before);
  });

  it("rejects excessive quantity and leaves stock unchanged", async () => {
    const product = await createProduct("Excessive Quantity", 3);
    const before = await countCustomerOrders();

    await expect(
      createOrder(merchantId, customerId, product.id, 4),
    ).rejects.toThrow("Insufficient stock");

    expect(await countCustomerOrders()).toBe(before);

    const unchanged = await prisma.product.findUnique({
      where: { id: product.id },
    });

    expect(unchanged!.stock).toBe(3);
  });

  it("rejects a nonexistent product", async () => {
    const before = await countCustomerOrders();

    await expect(
      createOrder(
        merchantId,
        customerId,
        "nonexistent-day5-product",
        1,
      ),
    ).rejects.toThrow("Product not found");

    expect(await countCustomerOrders()).toBe(before);
  });

  it("allows repeated product selection as independent orders", async () => {
    const product = await createProduct("Repeated Product", 10, 150);

    const first = await createOrder(
      merchantId,
      customerId,
      product.id,
      1,
    );

    const second = await createOrder(
      merchantId,
      customerId,
      product.id,
      2,
    );

    orders.push(first.id, second.id);

    expect(first.id).not.toBe(second.id);
    expect(first.orderNumber).not.toBe(second.orderNumber);

    expect(first.items[0].quantity).toBe(1);
    expect(second.items[0].quantity).toBe(2);

    expect(first.total).toBe(150);
    expect(second.total).toBe(300);

    const storedOrders = await prisma.order.findMany({
      where: {
        id: { in: [first.id, second.id] },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(storedOrders).toHaveLength(2);
    expect(
      storedOrders.every(
        (order) => order.status === OrderStatus.PENDING_PAYMENT,
      ),
    ).toBe(true);
  });

  it("keeps an abandoned order isolated from a later order", async () => {
    const productA = await createProduct("Abandoned Product", 10, 200);
    const productB = await createProduct("Later Product", 10, 300);

    const abandoned = await createOrder(
      merchantId,
      customerId,
      productA.id,
      1,
    );

    orders.push(abandoned.id);

    const later = await createOrder(
      merchantId,
      customerId,
      productB.id,
      1,
    );

    orders.push(later.id);

    expect(abandoned.id).not.toBe(later.id);
    expect(abandoned.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(later.status).toBe(OrderStatus.PENDING_PAYMENT);

    const abandonedStored = await prisma.order.findUnique({
      where: { id: abandoned.id },
    });

    const laterStored = await prisma.order.findUnique({
      where: { id: later.id },
    });

    expect(abandonedStored!.status).toBe(
      OrderStatus.PENDING_PAYMENT,
    );
    expect(laterStored!.status).toBe(
      OrderStatus.PENDING_PAYMENT,
    );
  });

  it("creates a new independent order after a paid order", async () => {
    const productA = await createProduct("Paid Order Product", 10, 400);
    const productB = await createProduct("After Paid Product", 10, 500);

    const paidOrder = await createOrder(
      merchantId,
      customerId,
      productA.id,
      1,
    );

    orders.push(paidOrder.id);

    const payment = await prisma.payment.create({
      data: {
        merchantId,
        orderId: paidOrder.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.VERIFIED,
        amount: paidOrder.total,
        currency: "ETB",
        transactionReference: `DAY5-PAID-${Date.now()}`,
        verifiedAt: new Date(),
      },
    });

    payments.push(payment.id);

    await prisma.order.update({
      where: { id: paidOrder.id },
      data: { status: OrderStatus.PAID },
    });

    const newOrder = await createOrder(
      merchantId,
      customerId,
      productB.id,
      1,
    );

    orders.push(newOrder.id);

    expect(newOrder.id).not.toBe(paidOrder.id);
    expect(newOrder.status).toBe(OrderStatus.PENDING_PAYMENT);

    const storedPaid = await prisma.order.findUnique({
      where: { id: paidOrder.id },
    });

    expect(storedPaid!.status).toBe(OrderStatus.PAID);
    expect(newOrder.items[0].productId).toBe(productB.id);
  });

  it("creates a new independent order after a rejected payment", async () => {
    const productA = await createProduct(
      "Rejected Order Product",
      10,
      600,
    );
    const productB = await createProduct(
      "After Rejected Product",
      10,
      700,
    );

    const rejectedOrder = await createOrder(
      merchantId,
      customerId,
      productA.id,
      1,
    );

    orders.push(rejectedOrder.id);

    await prisma.order.update({
      where: { id: rejectedOrder.id },
      data: { status: OrderStatus.PAYMENT_REVIEW },
    });

    const payment = await prisma.payment.create({
      data: {
        merchantId,
        orderId: rejectedOrder.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REJECTED,
        amount: rejectedOrder.total,
        currency: "ETB",
        transactionReference: `DAY5-REJECTED-${Date.now()}`,
        reviewNote: "Day 5 test rejection",
      },
    });

    payments.push(payment.id);

    const newOrder = await createOrder(
      merchantId,
      customerId,
      productB.id,
      1,
    );

    orders.push(newOrder.id);

    expect(newOrder.id).not.toBe(rejectedOrder.id);
    expect(newOrder.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(newOrder.items[0].productId).toBe(productB.id);

    const storedPayment = await prisma.payment.findUnique({
      where: { id: payment.id },
    });

    expect(storedPayment!.status).toBe(
      PaymentStatus.REJECTED,
    );
  });
});
