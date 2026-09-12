import { afterAll, describe, expect, it } from "vitest";
import {
  prisma,
  PaymentProvider,
  PaymentStatus,
  OrderStatus,
  ProductStatus,
} from "@ethio-commerce/database";

describe("Day 2 - multiple-order payment and receipt isolation", () => {
  const suffix = `day2-${Date.now()}`;

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

      await prisma.customer.deleteMany({
        where: {
          id: customerId,
        },
      });

      await prisma.merchant.deleteMany({
        where: {
          id: merchantId,
        },
      });
    }

    await prisma.$disconnect();
  });

  it("keeps three orders, payments, and receipts completely independent", async () => {
    /*
     * --------------------------------------------------
     * Create isolated test merchant/customer
     * --------------------------------------------------
     */
    const merchant = await prisma.merchant.create({
      data: {
        name: `Day 2 Test Merchant ${suffix}`,
        currency: "ETB",
      },
    });

    merchantId = merchant.id;

    const customer = await prisma.customer.create({
      data: {
        merchantId,
        name: `Day 2 Test Customer ${suffix}`,
        telegramChatId: `day2-chat-${Date.now()}`,
        telegramUserId: `day2-user-${Date.now()}`,
      },
    });

    customerId = customer.id;

    /*
     * --------------------------------------------------
     * Create three independent orders
     * --------------------------------------------------
     */
    const orderA = await prisma.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber: `DAY2-A-${Date.now()}`,
        status: OrderStatus.PENDING_PAYMENT,
        currency: "ETB",
        subtotal: 100,
        total: 100,
        items: {
          create: {
            productName: "Day 2 Product A",
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100,
          },
        },
      },
    });

    const orderB = await prisma.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber: `DAY2-B-${Date.now()}`,
        status: OrderStatus.PENDING_PAYMENT,
        currency: "ETB",
        subtotal: 200,
        total: 200,
        items: {
          create: {
            productName: "Day 2 Product B",
            quantity: 1,
            unitPrice: 200,
            lineTotal: 200,
          },
        },
      },
    });

    const orderC = await prisma.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber: `DAY2-C-${Date.now()}`,
        status: OrderStatus.PENDING_PAYMENT,
        currency: "ETB",
        subtotal: 300,
        total: 300,
        items: {
          create: {
            productName: "Day 2 Product C",
            quantity: 1,
            unitPrice: 300,
            lineTotal: 300,
          },
        },
      },
    });

    orders.push(orderA.id, orderB.id, orderC.id);

    expect(new Set(orders).size).toBe(3);

    /*
     * --------------------------------------------------
     * Create products with independent inventory.
     *
     * Each product is linked to exactly one order item.
     * --------------------------------------------------
     */
    const productA = await prisma.product.create({
      data: {
        merchantId,
        name: `Day 2 Inventory Product A ${suffix}`,
        price: 100,
        currency: "ETB",
        stock: 10,
        status: ProductStatus.ACTIVE,
      },
    });

    const productB = await prisma.product.create({
      data: {
        merchantId,
        name: `Day 2 Inventory Product B ${suffix}`,
        price: 200,
        currency: "ETB",
        stock: 20,
        status: ProductStatus.ACTIVE,
      },
    });

    const productC = await prisma.product.create({
      data: {
        merchantId,
        name: `Day 2 Inventory Product C ${suffix}`,
        price: 300,
        currency: "ETB",
        stock: 30,
        status: ProductStatus.ACTIVE,
      },
    });

    products.push(
      productA.id,
      productB.id,
      productC.id,
    );

    /*
     * Attach the products to their respective order items.
     */
    await prisma.orderItem.updateMany({
      where: {
        orderId: orderA.id,
      },
      data: {
        productId: productA.id,
      },
    });

    await prisma.orderItem.updateMany({
      where: {
        orderId: orderB.id,
      },
      data: {
        productId: productB.id,
      },
    });

    await prisma.orderItem.updateMany({
      where: {
        orderId: orderC.id,
      },
      data: {
        productId: productC.id,
      },
    });

    /*
     * --------------------------------------------------
     * Create Payment A + Receipt A
     * --------------------------------------------------
     */
    const paymentA = await prisma.payment.create({
      data: {
        merchantId,
        orderId: orderA.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount: 100,
        currency: "ETB",
        transactionReference: `DAY2-TXN-A-${Date.now()}`,
        receiptUrl:
          `receipts/${merchantId}/${orderA.id}/receipt-A-${Date.now()}.jpg`,
        receiptMetadata: {
          receiptId: "RECEIPT-A",
          orderId: orderA.id,
          paymentId: "PAYMENT-A",
        },
      },
    });

    /*
     * --------------------------------------------------
     * Create Payment B + Receipt B
     * --------------------------------------------------
     */
    const paymentB = await prisma.payment.create({
      data: {
        merchantId,
        orderId: orderB.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount: 200,
        currency: "ETB",
        transactionReference: `DAY2-TXN-B-${Date.now()}`,
        receiptUrl:
          `receipts/${merchantId}/${orderB.id}/receipt-B-${Date.now()}.jpg`,
        receiptMetadata: {
          receiptId: "RECEIPT-B",
          orderId: orderB.id,
          paymentId: "PAYMENT-B",
        },
      },
    });

    /*
     * --------------------------------------------------
     * Create Payment C + Receipt C
     * --------------------------------------------------
     */
    const paymentC = await prisma.payment.create({
      data: {
        merchantId,
        orderId: orderC.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount: 300,
        currency: "ETB",
        transactionReference: `DAY2-TXN-C-${Date.now()}`,
        receiptUrl:
          `receipts/${merchantId}/${orderC.id}/receipt-C-${Date.now()}.jpg`,
        receiptMetadata: {
          receiptId: "RECEIPT-C",
          orderId: orderC.id,
          paymentId: "PAYMENT-C",
        },
      },
    });

    payments.push(
      paymentA.id,
      paymentB.id,
      paymentC.id,
    );

    expect(new Set(payments).size).toBe(3);

    /*
     * Move all three orders into PAYMENT_REVIEW.
     */
    await prisma.order.updateMany({
      where: {
        id: {
          in: orders,
        },
      },
      data: {
        status: OrderStatus.PAYMENT_REVIEW,
      },
    });

    /*
     * --------------------------------------------------
     * Reload everything from DATABASE
     * --------------------------------------------------
     */
    const persistedPayments =
      await prisma.payment.findMany({
        where: {
          id: {
            in: payments,
          },
        },
        include: {
          order: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

    expect(persistedPayments).toHaveLength(3);

    const persistedA = persistedPayments.find(
      (payment) => payment.id === paymentA.id,
    );

    const persistedB = persistedPayments.find(
      (payment) => payment.id === paymentB.id,
    );

    const persistedC = persistedPayments.find(
      (payment) => payment.id === paymentC.id,
    );

    expect(persistedA).toBeDefined();
    expect(persistedB).toBeDefined();
    expect(persistedC).toBeDefined();

    /*
     * --------------------------------------------------
     * CRITICAL PAYMENT → ORDER INVARIANT
     * --------------------------------------------------
     */
    expect(persistedA!.orderId).toBe(orderA.id);
    expect(persistedB!.orderId).toBe(orderB.id);
    expect(persistedC!.orderId).toBe(orderC.id);

    expect(persistedA!.order.id).toBe(orderA.id);
    expect(persistedB!.order.id).toBe(orderB.id);
    expect(persistedC!.order.id).toBe(orderC.id);

    /*
     * --------------------------------------------------
     * RECEIPT ISOLATION
     * --------------------------------------------------
     */
    expect(persistedA!.receiptUrl).not.toBe(
      persistedB!.receiptUrl,
    );

    expect(persistedB!.receiptUrl).not.toBe(
      persistedC!.receiptUrl,
    );

    expect(persistedA!.receiptUrl).not.toBe(
      persistedC!.receiptUrl,
    );

    expect(
      (persistedA!.receiptMetadata as Record<string, unknown>)
        .receiptId,
    ).toBe("RECEIPT-A");

    expect(
      (persistedB!.receiptMetadata as Record<string, unknown>)
        .receiptId,
    ).toBe("RECEIPT-B");

    expect(
      (persistedC!.receiptMetadata as Record<string, unknown>)
        .receiptId,
    ).toBe("RECEIPT-C");

    /*
     * --------------------------------------------------
     * CROSS-ORDER PAYMENT QUERIES
     * --------------------------------------------------
     */
    const paymentForA =
      await prisma.payment.findFirst({
        where: {
          merchantId,
          orderId: orderA.id,
        },
      });

    const paymentForB =
      await prisma.payment.findFirst({
        where: {
          merchantId,
          orderId: orderB.id,
        },
      });

    const paymentForC =
      await prisma.payment.findFirst({
        where: {
          merchantId,
          orderId: orderC.id,
        },
      });

    expect(paymentForA!.id).toBe(paymentA.id);
    expect(paymentForB!.id).toBe(paymentB.id);
    expect(paymentForC!.id).toBe(paymentC.id);
  });

  it("isolates verification, rejection, inventory, and order state across three payments", async () => {
    /*
     * --------------------------------------------------
     * Create fresh products/orders/payments
     * --------------------------------------------------
     */
    const productA = await prisma.product.create({
      data: {
        merchantId,
        name: `Day 2 Review Product A ${suffix}`,
        price: 100,
        currency: "ETB",
        stock: 10,
        status: ProductStatus.ACTIVE,
      },
    });

    const productB = await prisma.product.create({
      data: {
        merchantId,
        name: `Day 2 Review Product B ${suffix}`,
        price: 200,
        currency: "ETB",
        stock: 20,
        status: ProductStatus.ACTIVE,
      },
    });

    const productC = await prisma.product.create({
      data: {
        merchantId,
        name: `Day 2 Review Product C ${suffix}`,
        price: 300,
        currency: "ETB",
        stock: 30,
        status: ProductStatus.ACTIVE,
      },
    });

    products.push(
      productA.id,
      productB.id,
      productC.id,
    );

    const orderA = await prisma.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber: `DAY2-REVIEW-A-${Date.now()}`,
        status: OrderStatus.PAYMENT_REVIEW,
        currency: "ETB",
        subtotal: 100,
        total: 100,
        items: {
          create: {
            productId: productA.id,
            productName: productA.name,
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100,
          },
        },
      },
    });

    const orderB = await prisma.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber: `DAY2-REVIEW-B-${Date.now()}`,
        status: OrderStatus.PAYMENT_REVIEW,
        currency: "ETB",
        subtotal: 200,
        total: 200,
        items: {
          create: {
            productId: productB.id,
            productName: productB.name,
            quantity: 1,
            unitPrice: 200,
            lineTotal: 200,
          },
        },
      },
    });

    const orderC = await prisma.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber: `DAY2-REVIEW-C-${Date.now()}`,
        status: OrderStatus.PAYMENT_REVIEW,
        currency: "ETB",
        subtotal: 300,
        total: 300,
        items: {
          create: {
            productId: productC.id,
            productName: productC.name,
            quantity: 1,
            unitPrice: 300,
            lineTotal: 300,
          },
        },
      },
    });

    orders.push(
      orderA.id,
      orderB.id,
      orderC.id,
    );

    const paymentA = await prisma.payment.create({
      data: {
        merchantId,
        orderId: orderA.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount: 100,
        currency: "ETB",
        transactionReference: `DAY2-REVIEW-TXN-A-${Date.now()}`,
        receiptUrl:
          `receipts/${merchantId}/${orderA.id}/review-A.jpg`,
        receiptMetadata: {
          receiptId: "REVIEW-RECEIPT-A",
          orderId: orderA.id,
        },
      },
    });

    const paymentB = await prisma.payment.create({
      data: {
        merchantId,
        orderId: orderB.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount: 200,
        currency: "ETB",
        transactionReference: `DAY2-REVIEW-TXN-B-${Date.now()}`,
        receiptUrl:
          `receipts/${merchantId}/${orderB.id}/review-B.jpg`,
        receiptMetadata: {
          receiptId: "REVIEW-RECEIPT-B",
          orderId: orderB.id,
        },
      },
    });

    const paymentC = await prisma.payment.create({
      data: {
        merchantId,
        orderId: orderC.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount: 300,
        currency: "ETB",
        transactionReference: `DAY2-REVIEW-TXN-C-${Date.now()}`,
        receiptUrl:
          `receipts/${merchantId}/${orderC.id}/review-C.jpg`,
        receiptMetadata: {
          receiptId: "REVIEW-RECEIPT-C",
          orderId: orderC.id,
        },
      },
    });

    payments.push(
      paymentA.id,
      paymentB.id,
      paymentC.id,
    );

    /*
     * --------------------------------------------------
     * VERIFY A — same transactional invariant as route
     * --------------------------------------------------
     */
    await prisma.$transaction(async (tx) => {
      const payment =
        await tx.payment.findFirst({
          where: {
            id: paymentA.id,
            merchantId,
          },
          include: {
            order: {
              include: {
                items: true,
              },
            },
          },
        });

      expect(payment).toBeDefined();
      expect(payment!.status).toBe(
        PaymentStatus.REVIEW_REQUIRED,
      );
      expect(payment!.order.status).toBe(
        OrderStatus.PAYMENT_REVIEW,
      );

      for (const item of payment!.order.items) {
        expect(item.productId).toBeDefined();

        const updated =
          await tx.product.updateMany({
            where: {
              id: item.productId!,
              merchantId,
              stock: {
                gte: item.quantity,
              },
            },
            data: {
              stock: {
                decrement: item.quantity,
              },
            },
          });

        expect(updated.count).toBe(1);
      }

      await tx.payment.update({
        where: {
          id: paymentA.id,
        },
        data: {
          status: PaymentStatus.VERIFIED,
          verifiedAt: new Date(),
          reviewNote: "Verified in Day 2 regression test",
        },
      });

      await tx.order.update({
        where: {
          id: orderA.id,
        },
        data: {
          status: OrderStatus.PAID,
        },
      });
    });

    /*
     * --------------------------------------------------
     * REJECT B — stock must remain untouched
     * --------------------------------------------------
     */
    await prisma.$transaction(async (tx) => {
      const payment =
        await tx.payment.findFirst({
          where: {
            id: paymentB.id,
            merchantId,
          },
        });

      expect(payment).toBeDefined();
      expect(payment!.status).toBe(
        PaymentStatus.REVIEW_REQUIRED,
      );

      await tx.payment.update({
        where: {
          id: paymentB.id,
        },
        data: {
          status: PaymentStatus.REJECTED,
          reviewNote: "Invalid receipt in Day 2 regression test",
        },
      });

      await tx.order.update({
        where: {
          id: orderB.id,
        },
        data: {
          status: OrderStatus.PENDING_PAYMENT,
        },
      });
    });

    /*
     * --------------------------------------------------
     * C remains untouched
     * --------------------------------------------------
     */
    const finalPayments =
      await prisma.payment.findMany({
        where: {
          id: {
            in: [
              paymentA.id,
              paymentB.id,
              paymentC.id,
            ],
          },
        },
      });

    const finalA = finalPayments.find(
      (payment) => payment.id === paymentA.id,
    );

    const finalB = finalPayments.find(
      (payment) => payment.id === paymentB.id,
    );

    const finalC = finalPayments.find(
      (payment) => payment.id === paymentC.id,
    );

    expect(finalA!.status).toBe(
      PaymentStatus.VERIFIED,
    );

    expect(finalB!.status).toBe(
      PaymentStatus.REJECTED,
    );

    expect(finalC!.status).toBe(
      PaymentStatus.REVIEW_REQUIRED,
    );

    const finalOrders =
      await prisma.order.findMany({
        where: {
          id: {
            in: [
              orderA.id,
              orderB.id,
              orderC.id,
            ],
          },
        },
      });

    expect(
      finalOrders.find(
        (order) => order.id === orderA.id,
      )!.status,
    ).toBe(OrderStatus.PAID);

    expect(
      finalOrders.find(
        (order) => order.id === orderB.id,
      )!.status,
    ).toBe(OrderStatus.PENDING_PAYMENT);

    expect(
      finalOrders.find(
        (order) => order.id === orderC.id,
      )!.status,
    ).toBe(OrderStatus.PAYMENT_REVIEW);

    /*
     * --------------------------------------------------
     * INVENTORY ISOLATION
     * --------------------------------------------------
     *
     * A was verified: stock 10 -> 9.
     * B was rejected: stock remains 20.
     * C remains under review: stock remains 30.
     */
    const finalProducts =
      await prisma.product.findMany({
        where: {
          id: {
            in: [
              productA.id,
              productB.id,
              productC.id,
            ],
          },
        },
      });

    expect(
      finalProducts.find(
        (product) => product.id === productA.id,
      )!.stock,
    ).toBe(9);

    expect(
      finalProducts.find(
        (product) => product.id === productB.id,
      )!.stock,
    ).toBe(20);

    expect(
      finalProducts.find(
        (product) => product.id === productC.id,
      )!.stock,
    ).toBe(30);

    /*
     * --------------------------------------------------
     * RECEIPT ISOLATION AFTER REVIEW
     * --------------------------------------------------
     */
    expect(finalA!.receiptUrl).toContain(
      orderA.id,
    );

    expect(finalB!.receiptUrl).toContain(
      orderB.id,
    );

    expect(finalC!.receiptUrl).toContain(
      orderC.id,
    );

    expect(finalA!.receiptUrl).not.toBe(
      finalB!.receiptUrl,
    );

    expect(finalB!.receiptUrl).not.toBe(
      finalC!.receiptUrl,
    );

    expect(finalA!.receiptUrl).not.toBe(
      finalC!.receiptUrl,
    );
  });
  it("allows only one concurrent verification to commit and decrements stock exactly once", async () => {
    /*
     * --------------------------------------------------
     * Create isolated product/order/payment
     * --------------------------------------------------
     */
    const product = await prisma.product.create({
      data: {
        merchantId,
        name: `Day 2 Concurrent Product ${suffix}`,
        price: 100,
        currency: "ETB",
        stock: 1,
        status: ProductStatus.ACTIVE,
      },
    });

    products.push(product.id);

    const order = await prisma.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber: `DAY2-CONCURRENT-${Date.now()}`,
        status: OrderStatus.PAYMENT_REVIEW,
        currency: "ETB",
        subtotal: 100,
        total: 100,
        items: {
          create: {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100,
          },
        },
      },
    });

    orders.push(order.id);

    const payment = await prisma.payment.create({
      data: {
        merchantId,
        orderId: order.id,
        provider: PaymentProvider.TELEBIRR,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount: 100,
        currency: "ETB",
        transactionReference:
          `DAY2-CONCURRENT-TXN-${Date.now()}`,
      },
    });

    payments.push(payment.id);

    /*
     * --------------------------------------------------
     * Run TWO verification transactions concurrently.
     *
     * This intentionally mirrors the critical ordering
     * used by the production verification route:
     *
     * 1. Load payment
     * 2. Validate REVIEW_REQUIRED
     * 3. Atomically decrement stock
     * 4. Conditionally claim payment
     * 5. Mark order PAID
     *
     * If the payment claim loses the race, the entire
     * transaction must roll back, including inventory.
     * --------------------------------------------------
     */
    const attemptVerification = async (
      reviewNote: string,
    ) => {
      try {
        await prisma.$transaction(async (tx) => {
          const loadedPayment =
            await tx.payment.findFirst({
              where: {
                id: payment.id,
                merchantId,
              },
              include: {
                order: {
                  include: {
                    items: true,
                  },
                },
              },
            });

          if (!loadedPayment) {
            throw new Error("Payment not found");
          }

          if (
            loadedPayment.status !==
            PaymentStatus.REVIEW_REQUIRED
          ) {
            throw new Error(
              `Payment cannot be verified because its current status is ${loadedPayment.status}`,
            );
          }

          if (
            loadedPayment.order.status !==
            OrderStatus.PAYMENT_REVIEW
          ) {
            throw new Error(
              `Order cannot be paid because its current status is ${loadedPayment.order.status}`,
            );
          }

          /*
           * Atomic inventory reservation.
           */
          for (
            const item of loadedPayment.order.items
          ) {
            if (!item.productId) {
              throw new Error(
                "Product information is missing",
              );
            }

            const updated =
              await tx.product.updateMany({
                where: {
                  id: item.productId,
                  merchantId,
                  stock: {
                    gte: item.quantity,
                  },
                },
                data: {
                  stock: {
                    decrement: item.quantity,
                  },
                },
              });

            if (updated.count !== 1) {
              throw new Error(
                "Insufficient stock",
              );
            }
          }

          /*
           * CRITICAL CONCURRENCY CLAIM.
           *
           * Only the transaction that still sees
           * REVIEW_REQUIRED may claim the payment.
           */
          const claimResult =
            await tx.payment.updateMany({
              where: {
                id: payment.id,
                merchantId,
                status:
                  PaymentStatus.REVIEW_REQUIRED,
              },
              data: {
                status:
                  PaymentStatus.VERIFIED,
                verifiedAt: new Date(),
                reviewNote,
              },
            });

          if (claimResult.count !== 1) {
            throw new Error(
              "Payment could not be claimed because it was already reviewed",
            );
          }

          /*
           * Only the successful claimant may mark
           * the order as PAID.
           */
          await tx.order.update({
            where: {
              id: order.id,
            },
            data: {
              status: OrderStatus.PAID,
            },
          });
        });

        return {
          success: true,
          error: null,
        };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        };
      }
    };

    /*
     * --------------------------------------------------
     * CONCURRENT ATTEMPTS
     * --------------------------------------------------
     */
    const results = await Promise.all([
      attemptVerification(
        "Concurrent verification attempt A",
      ),
      attemptVerification(
        "Concurrent verification attempt B",
      ),
    ]);

    /*
     * Exactly ONE verification may commit.
     */
    const successfulAttempts =
      results.filter(
        (result) => result.success,
      );

    const failedAttempts =
      results.filter(
        (result) => !result.success,
      );

    expect(successfulAttempts).toHaveLength(1);
    expect(failedAttempts).toHaveLength(1);

    /*
     * --------------------------------------------------
     * DATABASE FINAL STATE
     * --------------------------------------------------
     */
    const finalPayment =
      await prisma.payment.findUnique({
        where: {
          id: payment.id,
        },
      });

    const finalOrder =
      await prisma.order.findUnique({
        where: {
          id: order.id,
        },
      });

    const finalProduct =
      await prisma.product.findUnique({
        where: {
          id: product.id,
        },
      });

    /*
     * Payment verified exactly once.
     */
    expect(finalPayment).not.toBeNull();

    expect(finalPayment!.status).toBe(
      PaymentStatus.VERIFIED,
    );

    expect(finalPayment!.verifiedAt).not.toBeNull();

    /*
     * Order becomes PAID exactly once.
     */
    expect(finalOrder).not.toBeNull();

    expect(finalOrder!.status).toBe(
      OrderStatus.PAID,
    );

    /*
     * Stock was decremented exactly once:
     *
     * 1 -> 0
     *
     * The losing transaction must not leave behind
     * a second decrement.
     */
    expect(finalProduct).not.toBeNull();

    expect(finalProduct!.stock).toBe(0);

    /*
     * There must still be exactly one payment for
     * this order.
     */
    const paymentsForOrder =
      await prisma.payment.findMany({
        where: {
          merchantId,
          orderId: order.id,
        },
      });

    expect(paymentsForOrder).toHaveLength(1);
    expect(paymentsForOrder[0].id).toBe(
      payment.id,
    );
  });
});
