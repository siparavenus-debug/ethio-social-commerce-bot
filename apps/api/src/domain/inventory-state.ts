export type InventoryOrderItem = {
    productId: string | null;
    productName: string;
    quantity: number;
  };

  export type InventoryProduct = {
    id: string;
    name: string;
    stock: number;
  };

  export type InventoryStockUpdate = {
    productId: string;
    quantity: number;
    remainingStock: number;
  };

  export function calculateStockUpdates(
    items: InventoryOrderItem[],
    products: InventoryProduct[]
  ): InventoryStockUpdate[] {
    if (items.length === 0) {
      throw new Error(
        "Order has no items and cannot be verified"
      );
    }

    const quantityByProduct =
      new Map<string, number>();

    for (const item of items) {
      if (!item.productId) {
        throw new Error(
          `Product information is missing for order item "${item.productName}"`
        );
      }

      if (
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        throw new Error(
          `Invalid quantity for product "${item.productName}"`
        );
      }

      const existing =
        quantityByProduct.get(item.productId) || 0;

      quantityByProduct.set(
        item.productId,
        existing + item.quantity
      );
    }

    const stockUpdates: InventoryStockUpdate[] = [];

    for (const [
      productId,
      quantity
    ] of quantityByProduct) {
      const product =
        products.find(
          (candidate) =>
            candidate.id === productId
        );

      if (!product) {
        throw new Error(
          "A product in this order could not be found"
        );
      }

      if (product.stock < quantity) {
        throw new Error(
          `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${quantity}`
        );
      }

      stockUpdates.push({
        productId,
        quantity,
        remainingStock:
          product.stock - quantity
      });
    }

    return stockUpdates;
  }
