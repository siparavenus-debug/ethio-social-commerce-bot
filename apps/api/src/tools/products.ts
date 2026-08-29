import { prisma } from "@ethio-commerce/database";

export type ProductSearchResult = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number;
};

export async function searchProducts(
  merchantId: string,
  query: string
): Promise<ProductSearchResult[]> {
  const normalizedQuery = query.trim();

  const products = await prisma.product.findMany({
    where: {
      merchantId,
      status: "ACTIVE",
      ...(normalizedQuery
        ? {
            name: {
              contains: normalizedQuery,
              mode: "insensitive"
            }
          }
        : {})
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    currency: product.currency,
    stock: product.stock
  }));
}

export async function getProduct(
  merchantId: string,
  productId: string
): Promise<ProductSearchResult | null> {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      merchantId,
      status: "ACTIVE"
    }
  });

  if (!product) {
    return null;
  }

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    currency: product.currency,
    stock: product.stock
  };
}

export async function checkStock(
  merchantId: string,
  productId: string,
  quantity: number
): Promise<{
  available: boolean;
  stock: number;
}> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer");
  }

  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      merchantId,
      status: "ACTIVE"
    },
    select: {
      stock: true
    }
  });

  if (!product) {
    throw new Error("Product not found");
  }

  return {
    available: product.stock >= quantity,
    stock: product.stock
  };
}
