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

export type ProductSearchOptions = {
  maxPrice?: number;
  currency?: string;
  excludeProductIds?: string[];
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
  query: string,
  options: ProductSearchOptions = {}
): Promise<ProductSearchResult[]> {
  const normalizedQuery = query.trim();

  const queryTerms =
    normalizedQuery
      ? normalizedQuery
          .split(/\s+/)
          .filter(Boolean)
      : [];

  const products =
    await prisma.product.findMany({
      where: {
        merchantId,
        status: "ACTIVE",
        ...(options.excludeProductIds?.length
          ? {
              id: {
                notIn:
                  options.excludeProductIds
              }
            }
          : {}),
        ...(options.maxPrice !== undefined
          ? {
              price: {
                lte: options.maxPrice
              }
            }
          : {}),
        ...(options.currency !== undefined
          ? {
              currency: options.currency
            }
          : {}),
        ...(queryTerms.length > 0
          ? {
              AND: queryTerms.map(
                (term) => ({
                  OR: [
                    {
                      name: {
                        contains: term,
                        mode: "insensitive" as const
                      }
                    },
                    {
                      description: {
                        contains: term,
                        mode: "insensitive" as const
                      }
                    },
                    {
                      category: {
                        is: {
                          name: {
                            contains: term,
                            mode: "insensitive" as const
                          }
                        }
                      }
                    }
                  ]
                })
              )
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