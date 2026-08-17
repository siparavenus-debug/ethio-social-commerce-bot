import { prisma } from "@ethio-commerce/database";
import {
  PaymentProvider,
  PaymentStatus
} from "@ethio-commerce/database";

import {
  getConversationState,
  setConversationState,
  clearConversationState
} from "./conversation-state.js";

import {
  searchProducts,
  getProduct,
  checkStock
} from "../tools/products.js";

import {
  createOrder,
  getOrderStatus
} from "../tools/orders.js";

import {
  getPaymentInstructions
} from "../tools/payments.js";

export type ConversationContext = {
  merchantId: string;
  customerId: string;
  chatId: string;
  customerName: string | null;
  merchantName: string;
};

export type ConversationResult = {
  reply: string;
};

function isGreeting(text: string) {
  return /^(hello|hi|hey|start|\/start|good morning|good afternoon|good evening)$/i.test(
    text.trim()
  );
}

function isPositive(text: string) {
  return /^(yes|y|yeah|yep|confirm|confirmed|ok|okay)$/i.test(
    text.trim()
  );
}

function isNegative(text: string) {
  return /^(no|n|cancel|stop|not now)$/i.test(
    text.trim()
  );
}

function extractQuantity(text: string) {
  const match = text.trim().match(/^\d+$/);

  if (!match) {
    return null;
  }

  const quantity = Number(match[0]);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return null;
  }

  return quantity;
}

function looksLikePaymentReference(text: string) {
  const value = text.trim();

  if (value.length < 4 || value.length > 100) {
    return false;
  }

  return /^[A-Za-z0-9._/-]+$/.test(value);
}

function formatPaymentInstructions(
  paymentMethods: Array<{
    provider: string;
    accountName: string;
    accountNumber: string;
  }>
) {
  if (paymentMethods.length === 0) {
    return (
      "Payment instructions are not available yet.\n\n" +
      "Please contact the merchant to complete payment."
    );
  }

  const sections = paymentMethods.map((method) => {
    const providerName =
      method.provider === "CBE_BIRR"
        ? "CBE Birr"
        : method.provider === "TELEBIRR"
          ? "Telebirr"
          : method.provider;

    return (
      `${providerName}\n` +
      `Account name: ${method.accountName}\n` +
      `Account number: ${method.accountNumber}`
    );
  });

  return (
    "Payment instructions\n\n" +
    sections.join("\n\n") +
    "\n\n" +
    "After making the payment, send your transaction reference here."
  );
}

function formatProductSearchResults(
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    currency: string;
    stock: number;
  }>
) {
  if (products.length === 0) {
    return null;
  }

  const available = products.filter(
    (product) => product.stock > 0
  );

  if (available.length === 0) {
    return (
      "I found matching products, but they are currently out of stock.\n\n" +
      "Please try another product."
    );
  }

  if (available.length === 1) {
    const product = available[0];

    return (
      `${product.name}\n` +
      `Price: ${product.price} ${product.currency}\n` +
      `Available: ${product.stock}\n\n` +
      "How many would you like?"
    );
  }

  const lines = available.slice(0, 10).map((product, index) => {
    return (
      `${index + 1}. ${product.name}\n` +
      `   ${product.price} ${product.currency} • ${product.stock} available`
    );
  });

  return (
    "I found these products:\n\n" +
    lines.join("\n\n") +
    "\n\n" +
    "Please send the exact product name you want."
  );
}

export async function handleConversation(
  context: ConversationContext,
  text: string
): Promise<ConversationResult> {
  const {
    merchantId,
    customerId,
    chatId,
    merchantName
  } = context;

  const currentState =
    getConversationState(chatId);

  /*
   * STEP 1: Greeting
   */
  if (isGreeting(text)) {
    setConversationState(chatId, {});

    return {
      reply:
        `Welcome to ${merchantName}! 👋\n\n` +
        "I can help you find products and place an order.\n\n" +
        "Tell me what you're looking for.\n\n" +
        'For example:\n"Traditional Ethiopian Dress"'
    };
  }

  /*
   * STEP 2: Customer submits payment reference
   */
  if (
    currentState.awaitingPayment &&
    currentState.pendingOrderId
  ) {
    const transactionReference = text.trim();

    if (!looksLikePaymentReference(transactionReference)) {
      return {
        reply:
          "Please send a valid payment transaction reference.\n\n" +
          "For example:\n" +
          "TLB-123456789"
      };
    }

    const order = await getOrderStatus(
      merchantId,
      customerId,
      currentState.pendingOrderId
    );

    if (!order) {
      clearConversationState(chatId);

      return {
        reply:
          "Sorry, I couldn't find your pending order.\n\n" +
          "Please start a new order."
      };
    }

    if (
      order.status !== "PENDING_PAYMENT" &&
      order.status !== "PAYMENT_REVIEW"
    ) {
      clearConversationState(chatId);

      return {
        reply:
          `Your order ${order.orderNumber} is no longer awaiting payment.`
      };
    }

    const paymentMethods =
      await getPaymentInstructions(merchantId);

    const provider =
      paymentMethods.length === 1
        ? (paymentMethods[0].provider as PaymentProvider)
        : PaymentProvider.OTHER;

    const existingPayment =
      await prisma.payment.findFirst({
        where: {
          provider,
          transactionReference
        }
      });

    if (existingPayment) {
      return {
        reply:
          "That transaction reference has already been submitted.\n\n" +
          "Please check the reference and send a different one if necessary."
      };
    }

    const payment =
      await prisma.payment.create({
        data: {
          merchantId,
          orderId: order.id,
          provider,
          status: PaymentStatus.REVIEW_REQUIRED,
          amount: order.total,
          currency: order.currency,
          transactionReference
        }
      });

    await prisma.order.update({
      where: {
        id: order.id
      },
      data: {
        status: "PAYMENT_REVIEW"
      }
    });

    setConversationState(chatId, {
      awaitingPayment: true,
      pendingOrderId: order.id
    });

    return {
      reply:
        `Payment submitted for order ${order.orderNumber}. ✅\n\n` +
        `Transaction reference: ${payment.transactionReference}\n` +
        `Amount: ${payment.amount} ${payment.currency}\n\n` +
        "Your payment is now waiting for merchant review.\n\n" +
        "Please wait for payment confirmation."
    };
  }

  /*
   * STEP 3: Customer enters quantity
   */
  if (currentState.awaitingQuantity) {
    const quantity = extractQuantity(text);

    if (!quantity) {
      return {
        reply:
          "Please enter the quantity as a number.\n\n" +
          "For example: 2"
      };
    }

    if (!currentState.productId) {
      clearConversationState(chatId);

      return {
        reply:
          "Sorry, I lost the product information.\n\n" +
          "Please tell me the product name again."
      };
    }

    const product = await getProduct(
      merchantId,
      currentState.productId
    );

    if (!product) {
      clearConversationState(chatId);

      return {
        reply:
          "Sorry, that product is no longer available."
      };
    }

    const stock = await checkStock(
      merchantId,
      product.id,
      quantity
    );

    if (!stock.available) {
      return {
        reply:
          `Sorry, we only have ${stock.stock} available.\n\n` +
          `Please enter a quantity from 1 to ${stock.stock}.`
      };
    }

    const total = product.price * quantity;

    setConversationState(chatId, {
      productId: product.id,
      productName: product.name,
      quantity,
      awaitingConfirmation: true
    });

    return {
      reply:
        `${quantity} × ${product.name}\n` +
        `Unit price: ${product.price} ${product.currency}\n` +
        `Total: ${total.toFixed(2)} ${product.currency}\n\n` +
        "Would you like to place this order?\n" +
        "Reply YES or NO."
    };
  }

  /*
   * STEP 4: Customer confirms order
   */
  if (currentState.awaitingConfirmation) {
    if (isNegative(text)) {
      clearConversationState(chatId);

      return {
        reply:
          "No problem. Your order was cancelled.\n\n" +
          "You can start again whenever you're ready."
      };
    }

    if (!isPositive(text)) {
      return {
        reply:
          "Please reply YES to place the order or NO to cancel."
      };
    }

    if (
      !currentState.productId ||
      !currentState.quantity
    ) {
      clearConversationState(chatId);

      return {
        reply:
          "Sorry, I lost the order information.\n\n" +
          "Please start again by telling me the product name."
      };
    }

    const paymentMethods =
      await getPaymentInstructions(merchantId);

    if (paymentMethods.length === 0) {
      clearConversationState(chatId);

      return {
        reply:
          "Sorry, payment is not available right now.\n\n" +
          "The merchant has not configured an active payment method yet.\n\n" +
          "Please try again later."
      };
    }

    try {
      const order = await createOrder(
        merchantId,
        customerId,
        currentState.productId,
        currentState.quantity
      );

      setConversationState(chatId, {
        awaitingPayment: true,
        pendingOrderId: order.id
      });

      const item = order.items[0];

      return {
        reply:
          "Order confirmed! 🎉\n\n" +
          `Order: ${order.orderNumber}\n` +
          `${item.productName}\n` +
          `Quantity: ${item.quantity}\n` +
          `Total: ${order.total} ${order.currency}\n\n` +
          `${formatPaymentInstructions(paymentMethods)}\n\n` +
          "Your order will remain pending until the payment is verified."
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to create order";

      if (message.startsWith("Insufficient stock")) {
        clearConversationState(chatId);

        return {
          reply:
            "Sorry, the stock changed while we were creating the order.\n\n" +
            "Please search for the product again and choose an available quantity."
        };
      }

      throw error;
    }
  }

  /*
   * STEP 5: Product search
   */
  const products = await searchProducts(
    merchantId,
    text
  );

  if (products.length === 0) {
    return {
      reply:
        `I couldn't find a product matching "${text}".\n\n` +
        "Please try another product name."
    };
  }

  if (products.length === 1) {
    const product = products[0];

    if (product.stock <= 0) {
      return {
        reply:
          `${product.name} is currently out of stock.\n\n` +
          "Please ask about another product."
      };
    }

    setConversationState(chatId, {
      productId: product.id,
      productName: product.name,
      awaitingQuantity: true
    });

    return {
      reply:
        `${product.name}\n` +
        `Price: ${product.price} ${product.currency}\n` +
        `Available: ${product.stock}\n\n` +
        "How many would you like?"
    };
  }

  return {
    reply:
      formatProductSearchResults(products) ??
      `I couldn't find a product matching "${text}".`
  };
}