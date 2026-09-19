import { prisma } from "@ethio-commerce/database";

export type ProductSearchResult = {
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
};

function mapProduct(product: {
  id: string;
  name: string;
  description: string | null;
  price: unknown;
  currency: string;
  stock: number;
  images: Array<{
    url: string;
  }>;
  category: {
    id: string;
    name: string;
    imageUrl: string | null;
    imageAltText: string | null;
  } | null;
}): ProductSearchResult {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    currency: product.currency,
    stock: product.stock,
    imageUrl: product.images[0]?.url ?? null,
    category: product.category
  };
}

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
          OR: [
            {
              name: {
                contains: normalizedQuery,
                mode: "insensitive"
              }
            },
            {
              category: {
                is: {
                  name: {
                    contains: normalizedQuery,
                    mode: "insensitive"
                  }
                }
              }
            }
          ]
        }
        : {})
    },

    orderBy: {
      createdAt: "desc"
    },

    include: {
      images: {
        orderBy: [
          {
            isPrimary: "desc"
          },
          {
            sortOrder: "asc"
          }
        ],
        take: 1,
        select: {
          url: true
        }
      },
      category: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          imageAltText: true
        }
      }
    }
  });

  return products.map(mapProduct);
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
    },

    include: {
      images: {
        orderBy: [
          {
            isPrimary: "desc"
          },
          {
            sortOrder: "asc"
          }
        ],
        take: 1,
        select: {
          url: true
        }
      },
      category: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          imageAltText: true
        }
      }
    }
  });

  if (!product) {
    return null;
  }

  return mapProduct(product);
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