import { prisma } from "@ethio-commerce/database";
import {
  PaymentProvider,
  PaymentStatus
} from "@ethio-commerce/database";

import {
  getConversationState,
  setConversationState,
  updateConversationState,
  clearConversationState
} from "./conversation-state.js";

import {
  runAIConversation
} from "../ai/ai-orchestrator.js";

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
  imageUrl?: string;
};

const MAX_AI_MESSAGE_LENGTH = 4000;

function isGreeting(text: string) {
  return /^(hello|hi|hey|start|\/start|good morning|good afternoon|good evening|ሰላም|selam)$/i.test(
    text.trim()
  );
}

function isPositive(text: string) {
  return /^(yes|y|yeah|yep|confirm|confirmed|ok|okay|አዎ|awo)$/i.test(
    text.trim()
  );
}

function isNegative(text: string) {
  return /^(no|n|cancel|stop|not now|አይ|ay)$/i.test(
    text.trim()
  );
}

function extractQuantity(text: string) {
  const normalized =
    text
      .trim()
      .toLocaleLowerCase();

  const quantityWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    "አንድ": 1,
    "ሁለት": 2,
    "ሶስት": 3,
    "አራት": 4,
    "አምስት": 5,
    and: 1,
    hulet: 2,
    sost: 3,
    arat: 4,
    amist: 5
  };

  const wordQuantity =
    quantityWords[normalized];

  if (wordQuantity !== undefined) {
    return wordQuantity;
  }

  const numericMatch =
    normalized.match(
      /^(\d+)(?:\s*(?:pc|pcs|piece|pieces))?$/
    );

  if (!numericMatch) {
    return null;
  }

  const quantity =
    Number(numericMatch[1]);

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
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

  let currentState =
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
   *
   * IMPORTANT:
   * A payment that is already in PAYMENT_REVIEW belongs to the
   * completed payment flow. It must not block the customer from
   * starting another purchase. Only an order that is still
   * PENDING_PAYMENT should consume the next text message as a
   * transaction reference.
   */
  if (
    currentState.awaitingPayment &&
    currentState.pendingOrderId
  ) {
    const pendingOrder = await getOrderStatus(
      merchantId,
      customerId,
      currentState.pendingOrderId
    );

    if (!pendingOrder) {
      clearConversationState(chatId);
      currentState = {};
    } else if (pendingOrder.status === "PAYMENT_REVIEW") {
      /*
       * The previous order has already received a payment
       * submission. Release the payment lock so a new product
       * request starts a new order instead of being interpreted
       * as another payment reference for the old order.
       */
      currentState = {
        ...currentState,
        awaitingPayment: false,
        pendingOrderId: undefined,
        awaitingQuantity: false,
        awaitingConfirmation: false,
        productId: undefined,
        productName: undefined,
        productPrice: undefined,
        productCurrency: undefined,
        candidateProducts: undefined,
        quantity: undefined
      };

      setConversationState(chatId, currentState);
    } else if (pendingOrder.status === "PENDING_PAYMENT") {
      const transactionReference = text.trim();

      if (!looksLikePaymentReference(transactionReference)) {
        return {
          reply:
            "Please send a valid payment transaction reference.\n\n" +
            "For example:\n" +
            "TLB-123456789"
        };
      }

      const order = pendingOrder;

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
  }

  /*
   * Allow explicit cancellation throughout the
   * deterministic pre-order checkout flow.
   */
  const isPreOrderCheckout =
    currentState.awaitingQuantity ||
    currentState.awaitingConfirmation ||
    currentState.awaitingDeliveryName ||
    currentState.awaitingDeliveryPhone ||
    currentState.awaitingDeliveryAddress;

  if (
    isPreOrderCheckout &&
    isNegative(text)
  ) {
    clearConversationState(chatId);

    return {
      reply:
        "No problem. Your order was cancelled.\n\n" +
        "You can search for another product anytime."
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
      productPrice: product.price,
      productCurrency: product.currency,
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

    const correctedQuantity =
      extractQuantity(text);

    if (correctedQuantity) {
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
        correctedQuantity
      );

      if (!stock.available) {
        return {
          reply:
            `Sorry, we only have ${stock.stock} available.\n\n` +
            `Your quantity is still ${currentState.quantity}.\n\n` +
            `Please enter a quantity from 1 to ${stock.stock}, ` +
            "or reply YES or NO."
        };
      }

      const total =
        product.price *
        correctedQuantity;

      updateConversationState(chatId, {
        productId: product.id,
        productName: product.name,
        productPrice: product.price,
        productCurrency: product.currency,
        quantity: correctedQuantity,
        awaitingConfirmation: true
      });

      return {
        reply:
          `${correctedQuantity} × ${product.name}\n` +
          `Unit price: ${product.price} ${product.currency}\n` +
          `Total: ${total.toFixed(2)} ${product.currency}\n\n` +
          "Quantity updated.\n\n" +
          "Would you like to place this order?\n" +
          "Reply YES or NO."
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
    updateConversationState(chatId, {
      awaitingConfirmation: false,
      awaitingDeliveryName: true,
      awaitingDeliveryPhone: false,
      awaitingDeliveryAddress: false,
      deliveryName: undefined,
      deliveryPhone: undefined,
      deliveryAddress: undefined
    });

    return {
      reply:
        "Great. Before payment, I need the delivery details.\n\n" +
        "Please enter the recipient's full name."
    };
  }

  /*
 * STEP 4A: Collect delivery recipient name
 */
  if (currentState.awaitingDeliveryName) {
    const deliveryName = text.trim();

    if (!deliveryName) {
      return {
        reply:
          "Please enter the recipient's full name."
      };
    }

    updateConversationState(chatId, {
      awaitingDeliveryName: false,
      awaitingDeliveryPhone: true,
      deliveryName
    });

    return {
      reply:
        "Thank you.\n\n" +
        "Please enter the delivery phone number."
    };
  }

  /*
 * STEP 4B: Collect delivery phone
 */
  if (currentState.awaitingDeliveryPhone) {
    const deliveryPhone = text.trim();

    if (!deliveryPhone) {
      return {
        reply:
          "Please enter the delivery phone number."
      };
    }

    if (deliveryPhone.length > 50) {
      return {
        reply:
          "The delivery phone number is too long.\n\n" +
          "Please enter a phone number with at most 50 characters."
      };
    }

    updateConversationState(chatId, {
      awaitingDeliveryPhone: false,
      awaitingDeliveryAddress: true,
      deliveryPhone
    });

    return {
      reply:
        "Thank you.\n\n" +
        "Please enter the delivery address or location."
    };
  }

  /*
 * STEP 4C: Collect delivery address and create order
 */
  if (currentState.awaitingDeliveryAddress) {
    const deliveryAddress = text.trim();

    if (!deliveryAddress) {
      return {
        reply:
          "Please enter the delivery address or location."
      };
    }

    if (deliveryAddress.length > 1000) {
      return {
        reply:
          "The delivery address is too long.\n\n" +
          "Please enter an address with at most 1000 characters."
      };
    }

    if (
      !currentState.productId ||
      !currentState.quantity ||
      !currentState.deliveryName ||
      !currentState.deliveryPhone
    ) {
      clearConversationState(chatId);

      return {
        reply:
          "Sorry, I lost some of the order information.\n\n" +
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
        currentState.quantity,
        {
          name: currentState.deliveryName,
          phone: currentState.deliveryPhone,
          address: deliveryAddress
        }
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
   * STEP 5: AI natural-language conversation
   *
   * Payment submission, payment review, and order
   * confirmation remain deterministic above.
   *
   * Everything else can be understood naturally by AI.
   */

  /*
   * AI input security:
   *
   * Prevent unusually large customer messages from
   * being forwarded to the AI provider.
   *
   * This protects provider usage/cost while keeping
   * normal customer conversations unaffected.
   */
  if (text.length > MAX_AI_MESSAGE_LENGTH) {
    return {
      reply:
        "Your message is too long. Please shorten it and try again."
    };
  }

  const aiResult =
    await runAIConversation(
      {
        text,
        state: currentState,
        merchantName
      },
      {
        merchantId,
        customerId
      }
    );

  const aiResponse =
    aiResult.response;

  const nextState = {
    ...currentState,
    lastUserMessage: text,
    lastIntent: aiResponse.intent
  };

  const latestProductSearch =
    aiResult.searchContexts?.at(-1);

  const hasRelativePriceSearch =
    aiResult.toolResults.some(
      (toolResult) =>
        toolResult.tool ===
          "searchProducts" &&
        toolResult
          .isRelativePriceSearch ===
          true
    );

  const hasCrossSellSearch =
    aiResult.toolResults.some(
      (toolResult) =>
        toolResult.tool ===
          "searchProducts" &&
        toolResult
          .isCrossSellSearch ===
          true
    );

  if (
    latestProductSearch &&
    !hasRelativePriceSearch &&
    !hasCrossSellSearch
  ) {
    nextState.lastProductSearch = {
      ...latestProductSearch
    };
  }

  let responseImageUrl: string | undefined;

  let selectedProductPurchaseReply:
    string | undefined;

  for (const toolResult of aiResult.toolResults) {
    if (
      toolResult.tool === "searchProducts" &&
      Array.isArray(toolResult.result)
    ) {
      if (
        toolResult.isCrossSellSearch ===
          true
      ) {
        continue;
      }

      const products =
        toolResult.result as Array<{
          id: string;
          name: string;
          description: string | null;
          price: number;
          currency: string;
          stock: number;
          imageUrl: string | null;
          category: {
            id: string;
            name: string;
            imageUrl: string | null;
            imageAltText: string | null;
          } | null;
        }>;

        if (products.length === 0) {
          nextState.candidateProducts =
            undefined;

          if (
            !toolResult
              .isProductSearchContinuation
          ) {
            nextState.seenProductIds =
              undefined;
          }
        } else if (products.length === 1) {
          const product = products[0];

          if (
            toolResult
              .isProductSearchContinuation
          ) {
            nextState.seenProductIds = [
              ...new Set([
                ...(currentState
                  .seenProductIds ??
                  currentState
                    .candidateProducts
                    ?.map(
                      (candidate) =>
                        candidate.id
                    ) ??
                  (currentState.productId
                    ? [
                      currentState.productId
                    ]
                    : [])),
                product.id
              ])
            ];
          } else {
            nextState.seenProductIds = [
              product.id
            ];
          }

          nextState.candidateProducts =
            undefined;

          if (product.stock > 0) {
            nextState.productId =
              product.id;

            nextState.productName =
              product.name;

            nextState.productPrice =
              product.price;

            nextState.productCurrency =
              product.currency;

            nextState.awaitingQuantity =
              true;

            if (product.imageUrl) {
              responseImageUrl =
                product.imageUrl;
            }
          }
        } else if (products.length > 1) {
          const candidateProducts =
            products
              .slice(0, 10)
              .map((product) => ({
                id: product.id,
                name: product.name
              }));

          nextState.candidateProducts =
            candidateProducts;

          const returnedProductIds =
            candidateProducts.map(
              (product) => product.id
            );

          if (
            toolResult
              .isProductSearchContinuation
          ) {
            nextState.seenProductIds = [
              ...new Set([
                ...(currentState
                  .seenProductIds ??
                  currentState
                    .candidateProducts
                    ?.map(
                      (candidate) =>
                        candidate.id
                    ) ??
                  (currentState.productId
                    ? [
                      currentState.productId
                    ]
                    : [])),
                ...returnedProductIds
              ])
            ];
          } else {
            nextState.seenProductIds =
              returnedProductIds;

            nextState.productId =
              undefined;

            nextState.productName =
              undefined;

            nextState.productPrice =
              undefined;

            nextState.productCurrency =
              undefined;

            nextState.awaitingQuantity =
              false;

            nextState.awaitingConfirmation =
              false;

            nextState.quantity =
              undefined;
          }

          if (!toolResult.query) {
            continue;
          }
          const normalizedQuery =
            toolResult.query
              .trim()
              .toLocaleLowerCase();

          const firstCategory =
            products[0].category;

          const isMatchingCategory =
            firstCategory !== null &&
            firstCategory.name
              .toLocaleLowerCase()
              .includes(normalizedQuery);

          const allProductsShareCategory =
            firstCategory !== null &&
            products.every(
              (product) =>
                product.category?.id ===
                firstCategory.id
            );

          if (
            isMatchingCategory &&
            allProductsShareCategory &&
            firstCategory.imageUrl
          ) {
            responseImageUrl =
              firstCategory.imageUrl;
          }
        }
      }

    if (
      toolResult.tool === "getProduct" &&
      toolResult.result &&
      toolResult.isSelectedProductDetails !==
        true
    ) {
      const product =
        toolResult.result as {
          id: string;
          name: string;
          price: number;
          currency: string;
          stock: number;
          imageUrl: string | null;
        };

      nextState.productId =
        product.id;

      nextState.productName =
        product.name;

      nextState.productPrice =
        product.price;

      nextState.productCurrency =
        product.currency;

      nextState.candidateProducts =
        undefined;
    }

    if (
      toolResult.tool === "checkStock" &&
      toolResult.result &&
      toolResult.isSelectedProductStock !==
        true
    ) {
      const stock =
        toolResult.result as {
          available: boolean;
          stock: number;
        };

      if (stock.available) {
        if (
          toolResult.isSelectedProductPurchase ===
            true &&
          typeof toolResult.quantity ===
            "number" &&
          Number.isInteger(
            toolResult.quantity
          ) &&
          toolResult.quantity > 0 &&
          typeof nextState.productId ===
            "string"
        ) {
          const product =
            await getProduct(
              merchantId,
              nextState.productId
            );

          if (product) {
            nextState.productId =
              product.id;

            nextState.productName =
              product.name;

            nextState.productPrice =
              product.price;

            nextState.productCurrency =
              product.currency;

            nextState.quantity =
              toolResult.quantity;

            const total =
              product.price *
              toolResult.quantity;

            selectedProductPurchaseReply =
              `${toolResult.quantity} × ${product.name}\n` +
              `Unit price: ${product.price} ${product.currency}\n` +
              `Total: ${total.toFixed(2)} ${product.currency}\n\n` +
              "Would you like to place this order?\n" +
              "Reply YES or NO.";
          }
        }

        if (
          toolResult.isSelectedProductPurchase !==
            true ||
          selectedProductPurchaseReply !==
            undefined
        ) {
          nextState.awaitingConfirmation =
            true;
        }
      }
    }

  }

  const reply =
    selectedProductPurchaseReply ??
    aiResponse.message;

  const history =
    currentState.history ?? [];

  history.push(
    {
      role: "user",
      content: text
    },
    {
      role: "assistant",
      content: reply
    }
  );

  nextState.history =
    history.slice(-10);

  setConversationState(
    chatId,
    nextState
  );

  return {
    reply,
    ...(responseImageUrl
      ? {
        imageUrl: responseImageUrl
      }
      : {})
  };
}
