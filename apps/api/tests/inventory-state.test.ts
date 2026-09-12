import { describe, expect, it } from "vitest";

import {
  calculateStockUpdates,
  type InventoryOrderItem,
  type InventoryProduct
} from "../src/domain/inventory-state.js";

describe("inventory stock validation", () => {
  it("calculates the remaining stock for a valid order", () => {
    const items: InventoryOrderItem[] = [
      {
        productId: "product-1",
        productName: "Coffee",
        quantity: 2
      }
    ];

    const products: InventoryProduct[] = [
      {
        id: "product-1",
        name: "Coffee",
        stock: 10
      }
    ];

    expect(
      calculateStockUpdates(items, products)
    ).toEqual([
      {
        productId: "product-1",
        quantity: 2,
        remainingStock: 8
      }
    ]);
  });

  it("aggregates duplicate product lines before calculating stock", () => {
    const items: InventoryOrderItem[] = [
      {
        productId: "product-1",
        productName: "Coffee",
        quantity: 2
      },
      {
        productId: "product-1",
        productName: "Coffee",
        quantity: 3
      }
    ];

    const products: InventoryProduct[] = [
      {
        id: "product-1",
        name: "Coffee",
        stock: 10
      }
    ];

    expect(
      calculateStockUpdates(items, products)
    ).toEqual([
      {
        productId: "product-1",
        quantity: 5,
        remainingStock: 5
      }
    ]);
  });

  it("rejects an order item without a product", () => {
    const items: InventoryOrderItem[] = [
      {
        productId: null,
        productName: "Coffee",
        quantity: 1
      }
    ];

    expect(() =>
      calculateStockUpdates(items, [])
    ).toThrow(
      'Product information is missing for order item "Coffee"'
    );
  });

  it("rejects zero or negative quantities", () => {
    const products: InventoryProduct[] = [
      {
        id: "product-1",
        name: "Coffee",
        stock: 10
      }
    ];

    expect(() =>
      calculateStockUpdates(
        [
          {
            productId: "product-1",
            productName: "Coffee",
            quantity: 0
          }
        ],
        products
      )
    ).toThrow(
      'Invalid quantity for product "Coffee"'
    );

    expect(() =>
      calculateStockUpdates(
        [
          {
            productId: "product-1",
            productName: "Coffee",
            quantity: -1
          }
        ],
        products
      )
    ).toThrow(
      'Invalid quantity for product "Coffee"'
    );
  });

  it("rejects insufficient stock", () => {
    const items: InventoryOrderItem[] = [
      {
        productId: "product-1",
        productName: "Coffee",
        quantity: 6
      }
    ];

    const products: InventoryProduct[] = [
      {
        id: "product-1",
        name: "Coffee",
        stock: 5
      }
    ];

    expect(() =>
      calculateStockUpdates(items, products)
    ).toThrow(
      'Insufficient stock for "Coffee". Available: 5, requested: 6'
    );
  });

  it("rejects a product that cannot be found", () => {
    const items: InventoryOrderItem[] = [
      {
        productId: "missing-product",
        productName: "Coffee",
        quantity: 1
      }
    ];

    const products: InventoryProduct[] = [];

    expect(() =>
      calculateStockUpdates(items, products)
    ).toThrow(
      "A product in this order could not be found"
    );
  });

  it("rejects an order with no items", () => {
    expect(() =>
      calculateStockUpdates([], [])
    ).toThrow(
      "Order has no items and cannot be verified"
    );
  });
});
