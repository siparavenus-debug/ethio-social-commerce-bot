import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
  } from "vitest";

  import {
    prisma,
    OrderStatus,
    PaymentProvider,
    PaymentStatus,
  } from "@ethio-commerce/database";

  import {
    clearConversationState,
    getConversationState,
    setConversationState,
  } from "../src/conversation/conversation-state.js";

  describe("Day 2 - Telegram order correlation regression", () => {
    const suffix = `telegram-correlation-${Date.now()}`;

    let merchantId: string;
    let customerId: string;
    let chatId: string;

    let olderOrderId: string;
    let newerOrderId: string;

    let olderPaymentId: string;

    beforeAll(async () => {
      const merchant = await prisma.merchant.create({
        data: {
          name: `Day 2 Telegram Merchant ${suffix}`,
          currency: "ETB",
        },
      });

      merchantId = merchant.id;

      chatId = `telegram-correlation-chat-${Date.now()}`;

      const customer = await prisma.customer.create({
        data: {
          merchantId,
          name: `Day 2 Telegram Customer ${suffix}`,
          telegramChatId: chatId,
          telegramUserId: `telegram-user-${Date.now()}`,
        },
      });

      customerId = customer.id;

      /*
       * --------------------------------------------------
       * CREATE OLDER ORDER
       * --------------------------------------------------
       */
      const olderOrder = await prisma.order.create({
        data: {
          merchantId,
          customerId,
          orderNumber: `DAY2-TELEGRAM-A-${Date.now()}`,
          status: OrderStatus.PAYMENT_REVIEW,
          currency: "ETB",
          subtotal: 100,
          total: 100,
          items: {
            create: {
              productName: "Older Telegram Product",
              quantity: 1,
              unitPrice: 100,
              lineTotal: 100,
            },
          },
        },
      });

      olderOrderId = olderOrder.id;

      /*
       * Payment already belongs to the older order.
       */
      const olderPayment = await prisma.payment.create({
        data: {
          merchantId,
          orderId: olderOrder.id,
          provider: PaymentProvider.TELEBIRR,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: 100,
          currency: "ETB",
          transactionReference: `DAY2-TELEGRAM-A-${Date.now()}`,
          receiptUrl:
            `receipts/${merchantId}/${olderOrder.id}/older-receipt.jpg`,
          receiptMetadata: {
            receiptId: "OLDER-RECEIPT",
            orderId: olderOrder.id,
          },
        },
      });

      olderPaymentId = olderPayment.id;

      /*
       * --------------------------------------------------
       * CREATE NEWER ORDER
       * --------------------------------------------------
       *
       * This is deliberately newer and still awaiting
       * payment.
       */
      const newerOrder = await prisma.order.create({
        data: {
          merchantId,
          customerId,
          orderNumber: `DAY2-TELEGRAM-B-${Date.now()}`,
          status: OrderStatus.PENDING_PAYMENT,
          currency: "ETB",
          subtotal: 200,
          total: 200,
          items: {
            create: {
              productName: "Newer Telegram Product",
              quantity: 1,
              unitPrice: 200,
              lineTotal: 200,
            },
          },
        },
      });

      newerOrderId = newerOrder.id;
    });

    afterAll(async () => {
      clearConversationState(chatId);

      await prisma.payment.deleteMany({
        where: {
          merchantId,
        },
      });

      await prisma.orderItem.deleteMany({
        where: {
          order: {
            merchantId,
          },
        },
      });

      await prisma.order.deleteMany({
        where: {
          merchantId,
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

      await prisma.$disconnect();
    });

    it("uses the explicit conversation pendingOrderId instead of the newer order", async () => {
      /*
       * The customer is currently paying for the older order.
       *
       * Even though a newer pending order exists, the
       * conversation state is authoritative.
       */
      setConversationState(chatId, {
        awaitingPayment: true,
        pendingOrderId: olderOrderId,
      });

      const state = getConversationState(chatId);

      expect(state.pendingOrderId).toBe(
        olderOrderId,
      );

      /*
       * Reproduce the exact correlation rule used by
       * the Telegram webhook.
       */
      const targetOrder =
        await prisma.order.findFirst({
          where: {
            id: state.pendingOrderId,
            merchantId,
            customerId,
            status: {
              in: [
                OrderStatus.PENDING_PAYMENT,
                OrderStatus.PAYMENT_REVIEW,
              ],
            },
          },
          select: {
            id: true,
            orderNumber: true,
            total: true,
            currency: true,
          },
        });

      expect(targetOrder).not.toBeNull();

      /*
       * CRITICAL:
       *
       * The newer order must NOT replace the explicitly
       * selected older order.
       */
      expect(targetOrder!.id).toBe(
        olderOrderId,
      );

      expect(targetOrder!.id).not.toBe(
        newerOrderId,
      );

      /*
       * Payment lookup must remain scoped to the exact
       * target order.
       */
      const payment =
        await prisma.payment.findFirst({
          where: {
            merchantId,
            orderId: targetOrder!.id,
            status: {
              in: [
                PaymentStatus.PENDING,
                PaymentStatus.REVIEW_REQUIRED,
              ],
            },
          },
        });

      expect(payment).not.toBeNull();

      expect(payment!.id).toBe(
        olderPaymentId,
      );

      expect(payment!.orderId).toBe(
        olderOrderId,
      );

      /*
       * The payment must never point to the newer order.
       */
      expect(payment!.orderId).not.toBe(
        newerOrderId,
      );
    });

    it("falls back to the newest pending order when no valid conversation order exists", async () => {
      /*
       * Remove the explicit order association.
       */
      clearConversationState(chatId);

      const state = getConversationState(chatId);

      expect(state.pendingOrderId).toBeUndefined();

      /*
       * Reproduce the webhook fallback:
       *
       * newest PENDING_PAYMENT order for this exact
       * merchant + customer.
       */
      const fallbackOrder =
        await prisma.order.findFirst({
          where: {
            merchantId,
            customerId,
            status: OrderStatus.PENDING_PAYMENT,
          },
          select: {
            id: true,
            orderNumber: true,
            total: true,
            currency: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

      expect(fallbackOrder).not.toBeNull();

      /*
       * The newer pending order must be selected.
       */
      expect(fallbackOrder!.id).toBe(
        newerOrderId,
      );

      expect(fallbackOrder!.id).not.toBe(
        olderOrderId,
      );
    });

    it("does not allow another customer's order to satisfy the conversation order", async () => {
      /*
       * Put the correct customer's order ID into
       * conversation state.
       */
      setConversationState(chatId, {
        awaitingPayment: true,
        pendingOrderId: newerOrderId,
      });

      /*
       * Search using a different customer ID.
       *
       * The order must not resolve.
       */
      const wrongCustomerOrder =
        await prisma.order.findFirst({
          where: {
            id: newerOrderId,
            merchantId,
            customerId: `not-${customerId}`,
            status: {
              in: [
                OrderStatus.PENDING_PAYMENT,
                OrderStatus.PAYMENT_REVIEW,
              ],
            },
          },
        });

      expect(wrongCustomerOrder).toBeNull();
    });
  });
