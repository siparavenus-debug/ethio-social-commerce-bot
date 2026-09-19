import { prisma } from "@ethio-commerce/database";
import { requireMerchantEntitlement } from "../services/subscription-entitlement.js";

export type CreatedOrder = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  subtotal: number;
  total: number;
  items: Array<{
    productId: string | null;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
};

export type DeliverySnapshot = {
  name: string;
  phone: string;
  address: string;
};

export async function createOrder(
  merchantId: string,
  customerId: string,
  productId: string,
  quantity: number,
  delivery: DeliverySnapshot
): Promise<CreatedOrder> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer");
  }

  const deliveryName = delivery.name.trim();
  const deliveryPhone = delivery.phone.trim();
  const deliveryAddress = delivery.address.trim();

  if (!deliveryName) {
    throw new Error("Delivery name is required");
  }

  if (!deliveryPhone) {
    throw new Error("Delivery phone is required");
  }

  if (deliveryPhone.length > 50) {
    throw new Error(
      "Delivery phone must be at most 50 characters"
    );
  }

  if (!deliveryAddress) {
    throw new Error("Delivery address is required");
  }

  if (deliveryAddress.length > 1000) {
    throw new Error(
      "Delivery address must be at most 1000 characters"
    );
  }

  const orderNumber = `TG-${Date.now()}`;

  return prisma.$transaction(async (tx) => {
    await requireMerchantEntitlement(
      tx,
      merchantId,
      "CREATE_COMMERCE"
    );

    const product = await tx.product.findFirst({
      where: {
        id: productId,
        merchantId,
        status: "ACTIVE"
      }
    });

    if (!product) {
      throw new Error("Product not found");
    }

    /*
     * IMPORTANT:
     * Stock is checked when the order is created,
     * but it is NOT decremented here.
     *
     * Inventory is committed only when the merchant
     * verifies the customer's payment.
     */
    if (product.stock < quantity) {
      throw new Error(
        `Insufficient stock for product "${product.name}". Available: ${product.stock}, requested: ${quantity}`
      );
    }

    const unitPrice = Number(product.price);
    const subtotal = unitPrice * quantity;

    const order = await tx.order.create({
      data: {
        merchantId,
        customerId,
        orderNumber,
        status: "PENDING_PAYMENT",
        currency: product.currency,
        subtotal,
        total: subtotal,
        deliveryName,
        deliveryPhone,
        deliveryAddress,
        items: {
          create: [
            {
              productId: product.id,
              productName: product.name,
              quantity,
              unitPrice,
              lineTotal: subtotal
            }
          ]
        }
      },
      include: {
        items: true
      }
    });

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      subtotal: Number(order.subtotal),
      total: Number(order.total),
      items: order.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal)
      }))
    };
  });
}

export async function getOrderStatus(
  merchantId: string,
  customerId: string,
  orderId: string
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      merchantId,
      customerId
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      currency: true,
      total: true,
      createdAt: true,
      updatedAt: true
    }
  });

  if (!order) {
    return null;
  }

  return {
    ...order,
    total: Number(order.total)
  };
}
