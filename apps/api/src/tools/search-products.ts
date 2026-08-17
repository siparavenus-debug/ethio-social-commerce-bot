import { prisma } from "@ethio-commerce/database";

export type SearchProductsInput = {
  merchantId: string;
  query: string;
};

export type SearchProductResult = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number;
};

export async function searchProducts(
  input: SearchProductsInput
): Promise<SearchProductResult[]> {
  const query = input.query.trim();

  if (!input.merchantId) {
    throw new Error("merchantId is required");
  }

  if (!query) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      merchantId: input.merchantId,
      status: "ACTIVE",
      OR: [
        {
          name: {
            contains: query,
            mode: "insensitive"
          }
        },
        {
          description: {
            contains: query,
            mode: "insensitive"
          }
        }
      ]
    },
    orderBy: {
      createdAt: "asc"
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