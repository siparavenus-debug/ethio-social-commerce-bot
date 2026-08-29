import { Router } from "express";
import { prisma } from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess
} from "../middleware/auth.js";

const router = Router();

router.use(
  requireAuth,
  requireMerchantAccess
);

const PRODUCT_NAME_MAX_LENGTH = 200;
const PRODUCT_DESCRIPTION_MAX_LENGTH = 5000;
const CATEGORY_NAME_MAX_LENGTH = 100;
const IMAGE_URL_MAX_LENGTH = 2048;
const IMAGE_ALT_TEXT_MAX_LENGTH = 300;

const VALID_PRODUCT_STATUSES = [
  "ACTIVE",
  "DRAFT",
  "ARCHIVED"
] as const;

function isValidProductStatus(
  value: unknown
): value is (typeof VALID_PRODUCT_STATUSES)[number] {
  return (
    typeof value === "string" &&
    VALID_PRODUCT_STATUSES.includes(
      value as (typeof VALID_PRODUCT_STATUSES)[number]
    )
  );
}

function isValidImageUrl(
  value: unknown
): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > IMAGE_URL_MAX_LENGTH
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);

    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:"
    );
  } catch {
    return false;
  }
}

/*
 * --------------------------------------------------------------------------
 * PRODUCT CATEGORIES
 * --------------------------------------------------------------------------
 */

/**
 * List product categories.
 *
 * GET /merchants/:merchantId/products/categories
 */
router.get(
  "/:merchantId/products/categories",
  async (req, res) => {
    try {
      const { merchantId } = req.params;

      const categories =
        await prisma.productCategory.findMany({
          where: {
            merchantId
          },
          orderBy: {
            name: "asc"
          },
          include: {
            _count: {
              select: {
                products: true
              }
            }
          }
        });

      res.json(categories);
    } catch (error) {
      console.error(
        "Failed to list product categories:",
        error
      );

      res.status(500).json({
        error: "Failed to list product categories"
      });
    }
  }
);

/**
 * Create a product category.
 *
 * POST /merchants/:merchantId/products/categories
 *
 * Body:
 * {
 *   "name": "Shoes"
 * }
 */
router.post(
  "/:merchantId/products/categories",
  async (req, res) => {
    try {
      const { merchantId } = req.params;
      const { name } = req.body;

      if (
        typeof name !== "string" ||
        name.trim().length === 0
      ) {
        res.status(400).json({
          error: "name is required"
        });
        return;
      }

      const trimmedName = name.trim();

      if (
        trimmedName.length > CATEGORY_NAME_MAX_LENGTH
      ) {
        res.status(400).json({
          error: `name must be ${CATEGORY_NAME_MAX_LENGTH} characters or fewer`
        });
        return;
      }

      const merchant =
        await prisma.merchant.findUnique({
          where: {
            id: merchantId
          },
          select: {
            id: true
          }
        });

      if (!merchant) {
        res.status(404).json({
          error: "Merchant not found"
        });
        return;
      }

      const existingCategory =
        await prisma.productCategory.findUnique({
          where: {
            merchantId_name: {
              merchantId,
              name: trimmedName
            }
          }
        });

      if (existingCategory) {
        res.status(409).json({
          error: "A category with this name already exists"
        });
        return;
      }

      const category =
        await prisma.productCategory.create({
          data: {
            merchantId,
            name: trimmedName
          }
        });

      res.status(201).json(category);
    } catch (error) {
      console.error(
        "Failed to create product category:",
        error
      );

      res.status(500).json({
        error: "Failed to create product category"
      });
    }
  }
);

/**
 * Delete a product category.
 *
 * Products assigned to this category keep their products,
 * but categoryId becomes null because the Prisma relation
 * uses onDelete: SetNull.
 *
 * DELETE /merchants/:merchantId/products/categories/:categoryId
 */
router.delete(
  "/:merchantId/products/categories/:categoryId",
  async (req, res) => {
    try {
      const {
        merchantId,
        categoryId
      } = req.params;

      const category =
        await prisma.productCategory.findFirst({
          where: {
            id: categoryId,
            merchantId
          }
        });

      if (!category) {
        res.status(404).json({
          error: "Category not found"
        });
        return;
      }

      await prisma.productCategory.delete({
        where: {
          id: category.id
        }
      });

      res.json({
        message: "Category deleted successfully"
      });
    } catch (error) {
      console.error(
        "Failed to delete product category:",
        error
      );

      res.status(500).json({
        error: "Failed to delete product category"
      });
    }
  }
);

/*
 * --------------------------------------------------------------------------
 * PRODUCTS
 * --------------------------------------------------------------------------
 */

/**
 * List products.
 *
 * GET /merchants/:merchantId/products
 */
router.get(
  "/:merchantId/products",
  async (req, res) => {
    try {
      const { merchantId } = req.params;

      const products =
        await prisma.product.findMany({
          where: {
            merchantId
          },
          orderBy: {
            createdAt: "desc"
          },
          include: {
            category: true,
            images: {
              orderBy: [
                {
                  isPrimary: "desc"
                },
                {
                  sortOrder: "asc"
                }
              ]
            }
          }
        });

      res.json(products);
    } catch (error) {
      console.error(
        "Failed to list products:",
        error
      );

      res.status(500).json({
        error: "Failed to list products"
      });
    }
  }
);

/**
 * Get a single product.
 *
 * GET /merchants/:merchantId/products/:productId
 */
router.get(
  "/:merchantId/products/:productId",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId
      } = req.params;

      const product =
        await prisma.product.findFirst({
          where: {
            id: productId,
            merchantId
          },
          include: {
            category: true,
            images: {
              orderBy: [
                {
                  isPrimary: "desc"
                },
                {
                  sortOrder: "asc"
                }
              ]
            }
          }
        });

      if (!product) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      res.json(product);
    } catch (error) {
      console.error(
        "Failed to get product:",
        error
      );

      res.status(500).json({
        error: "Failed to get product"
      });
    }
  }
);

/**
 * Create a product.
 *
 * POST /merchants/:merchantId/products
 *
 * Body:
 * {
 *   "name": "Product name",
 *   "description": "Description",
 *   "price": 1500,
 *   "currency": "ETB",
 *   "stock": 10,
 *   "status": "ACTIVE",
 *   "categoryId": "..."
 * }
 */
router.post(
  "/:merchantId/products",
  async (req, res) => {
    try {
      const { merchantId } = req.params;

      const {
        name,
        description,
        price,
        currency,
        stock,
        status,
        categoryId
      } = req.body;

      if (
        typeof name !== "string" ||
        name.trim().length === 0
      ) {
        res.status(400).json({
          error: "name is required"
        });
        return;
      }

      const trimmedName = name.trim();

      if (
        trimmedName.length > PRODUCT_NAME_MAX_LENGTH
      ) {
        res.status(400).json({
          error: `name must be ${PRODUCT_NAME_MAX_LENGTH} characters or fewer`
        });
        return;
      }

      if (
        description !== undefined &&
        description !== null &&
        typeof description !== "string"
      ) {
        res.status(400).json({
          error: "description must be a string"
        });
        return;
      }

      const trimmedDescription =
        typeof description === "string" &&
        description.trim().length > 0
          ? description.trim()
          : null;

      if (
        trimmedDescription &&
        trimmedDescription.length >
          PRODUCT_DESCRIPTION_MAX_LENGTH
      ) {
        res.status(400).json({
          error: `description must be ${PRODUCT_DESCRIPTION_MAX_LENGTH} characters or fewer`
        });
        return;
      }

      const numericPrice = Number(price);

      if (
        !Number.isFinite(numericPrice) ||
        numericPrice < 0
      ) {
        res.status(400).json({
          error: "price must be a non-negative number"
        });
        return;
      }

      const numericStock =
        stock === undefined
          ? 0
          : Number(stock);

      if (
        !Number.isInteger(numericStock) ||
        numericStock < 0
      ) {
        res.status(400).json({
          error: "stock must be a non-negative integer"
        });
        return;
      }

      if (
        status !== undefined &&
        !isValidProductStatus(status)
      ) {
        res.status(400).json({
          error:
            "status must be ACTIVE, DRAFT, or ARCHIVED"
        });
        return;
      }

      if (
        categoryId !== undefined &&
        categoryId !== null &&
        typeof categoryId !== "string"
      ) {
        res.status(400).json({
          error: "categoryId must be a string"
        });
        return;
      }

      const merchant =
        await prisma.merchant.findUnique({
          where: {
            id: merchantId
          }
        });

      if (!merchant) {
        res.status(404).json({
          error: "Merchant not found"
        });
        return;
      }

      if (categoryId) {
        const category =
          await prisma.productCategory.findFirst({
            where: {
              id: categoryId,
              merchantId
            }
          });

        if (!category) {
          res.status(400).json({
            error: "Category not found"
          });
          return;
        }
      }

      const product =
        await prisma.product.create({
          data: {
            merchantId,
            categoryId:
              categoryId ?? null,
            name: trimmedName,
            description:
              trimmedDescription,
            price: numericPrice,
            currency:
              typeof currency === "string" &&
              currency.trim().length > 0
                ? currency.trim().toUpperCase()
                : merchant.currency,
            stock: numericStock,
            status:
              status ?? "DRAFT"
          },
          include: {
            category: true,
            images: true
          }
        });

      res.status(201).json(product);
    } catch (error) {
      console.error(
        "Failed to create product:",
        error
      );

      res.status(500).json({
        error: "Failed to create product"
      });
    }
  }
);

/**
 * Update a product.
 *
 * PATCH /merchants/:merchantId/products/:productId
 */
router.patch(
  "/:merchantId/products/:productId",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId
      } = req.params;

      const {
        name,
        description,
        price,
        currency,
        stock,
        status,
        categoryId
      } = req.body;

      const existingProduct =
        await prisma.product.findFirst({
          where: {
            id: productId,
            merchantId
          }
        });

      if (!existingProduct) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      const data: {
        name?: string;
        description?: string | null;
        price?: number;
        currency?: string;
        stock?: number;
        status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
        categoryId?: string | null;
      } = {};

      if (name !== undefined) {
        if (
          typeof name !== "string" ||
          name.trim().length === 0
        ) {
          res.status(400).json({
            error: "name must be a non-empty string"
          });
          return;
        }

        const trimmedName = name.trim();

        if (
          trimmedName.length >
          PRODUCT_NAME_MAX_LENGTH
        ) {
          res.status(400).json({
            error: `name must be ${PRODUCT_NAME_MAX_LENGTH} characters or fewer`
          });
          return;
        }

        data.name = trimmedName;
      }

      if (description !== undefined) {
        if (
          description !== null &&
          typeof description !== "string"
        ) {
          res.status(400).json({
            error:
              "description must be a string or null"
          });
          return;
        }

        const trimmedDescription =
          typeof description === "string" &&
          description.trim().length > 0
            ? description.trim()
            : null;

        if (
          trimmedDescription &&
          trimmedDescription.length >
            PRODUCT_DESCRIPTION_MAX_LENGTH
        ) {
          res.status(400).json({
            error: `description must be ${PRODUCT_DESCRIPTION_MAX_LENGTH} characters or fewer`
          });
          return;
        }

        data.description =
          trimmedDescription;
      }

      if (price !== undefined) {
        const numericPrice = Number(price);

        if (
          !Number.isFinite(numericPrice) ||
          numericPrice < 0
        ) {
          res.status(400).json({
            error:
              "price must be a non-negative number"
          });
          return;
        }

        data.price = numericPrice;
      }

      if (currency !== undefined) {
        if (
          typeof currency !== "string" ||
          currency.trim().length === 0
        ) {
          res.status(400).json({
            error:
              "currency must be a non-empty string"
          });
          return;
        }

        const normalizedCurrency =
          currency.trim().toUpperCase();

        if (
          normalizedCurrency.length !== 3
        ) {
          res.status(400).json({
            error:
              "currency must be a 3-letter currency code"
          });
          return;
        }

        data.currency =
          normalizedCurrency;
      }

      if (stock !== undefined) {
        const numericStock = Number(stock);

        if (
          !Number.isInteger(numericStock) ||
          numericStock < 0
        ) {
          res.status(400).json({
            error:
              "stock must be a non-negative integer"
          });
          return;
        }

        data.stock = numericStock;
      }

      if (status !== undefined) {
        if (!isValidProductStatus(status)) {
          res.status(400).json({
            error:
              "status must be ACTIVE, DRAFT, or ARCHIVED"
          });
          return;
        }

        data.status = status;
      }

      if (categoryId !== undefined) {
        if (
          categoryId !== null &&
          typeof categoryId !== "string"
        ) {
          res.status(400).json({
            error:
              "categoryId must be a string or null"
          });
          return;
        }

        if (categoryId) {
          const category =
            await prisma.productCategory.findFirst({
              where: {
                id: categoryId,
                merchantId
              }
            });

          if (!category) {
            res.status(400).json({
              error: "Category not found"
            });
            return;
          }
        }

        data.categoryId =
          categoryId;
      }

      const updatedProduct =
        await prisma.product.update({
          where: {
            id: existingProduct.id
          },
          data,
          include: {
            category: true,
            images: {
              orderBy: [
                {
                  isPrimary: "desc"
                },
                {
                  sortOrder: "asc"
                }
              ]
            }
          }
        });

      res.json(updatedProduct);
    } catch (error) {
      console.error(
        "Failed to update product:",
        error
      );

      res.status(500).json({
        error: "Failed to update product"
      });
    }
  }
);

/**
 * Delete a product.
 *
 * DELETE /merchants/:merchantId/products/:productId
 */
router.delete(
  "/:merchantId/products/:productId",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId
      } = req.params;

      const product =
        await prisma.product.findFirst({
          where: {
            id: productId,
            merchantId
          }
        });

      if (!product) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      await prisma.product.delete({
        where: {
          id: product.id
        }
      });

      res.json({
        message: "Product deleted successfully"
      });
    } catch (error) {
      console.error(
        "Failed to delete product:",
        error
      );

      res.status(500).json({
        error: "Failed to delete product"
      });
    }
  }
);

/*
 * --------------------------------------------------------------------------
 * PRODUCT STOCK
 * --------------------------------------------------------------------------
 */

/**
 * Set the exact stock quantity.
 *
 * PATCH /merchants/:merchantId/products/:productId/stock
 *
 * Body:
 * {
 *   "stock": 20
 * }
 */
router.patch(
  "/:merchantId/products/:productId/stock",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId
      } = req.params;

      const { stock } = req.body;

      const numericStock = Number(stock);

      if (
        !Number.isInteger(numericStock) ||
        numericStock < 0
      ) {
        res.status(400).json({
          error:
            "stock must be a non-negative integer"
        });
        return;
      }

      const product =
        await prisma.product.findFirst({
          where: {
            id: productId,
            merchantId
          }
        });

      if (!product) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      const updatedProduct =
        await prisma.product.update({
          where: {
            id: product.id
          },
          data: {
            stock: numericStock
          }
        });

      res.json(updatedProduct);
    } catch (error) {
      console.error(
        "Failed to update product stock:",
        error
      );

      res.status(500).json({
        error: "Failed to update product stock"
      });
    }
  }
);

/**
 * Restock a product.
 *
 * POST /merchants/:merchantId/products/:productId/restock
 *
 * Body:
 * {
 *   "quantity": 10,
 *   "note": "New shipment received"
 * }
 */
router.post(
  "/:merchantId/products/:productId/restock",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId
      } = req.params;

      const {
        quantity,
        note
      } = req.body;

      const numericQuantity =
        Number(quantity);

      if (
        !Number.isInteger(numericQuantity) ||
        numericQuantity <= 0
      ) {
        res.status(400).json({
          error:
            "quantity must be a positive integer"
        });
        return;
      }

      if (
        note !== undefined &&
        note !== null &&
        typeof note !== "string"
      ) {
        res.status(400).json({
          error: "note must be a string"
        });
        return;
      }

      const trimmedNote =
        typeof note === "string" &&
        note.trim().length > 0
          ? note.trim()
          : null;

      if (
        trimmedNote &&
        trimmedNote.length > 1000
      ) {
        res.status(400).json({
          error:
            "note must be 1000 characters or fewer"
        });
        return;
      }

      const result =
        await prisma.$transaction(
          async (tx) => {
            const product =
              await tx.product.findFirst({
                where: {
                  id: productId,
                  merchantId
                }
              });

            if (!product) {
              return null;
            }

            const updatedProduct =
              await tx.product.update({
                where: {
                  id: product.id
                },
                data: {
                  stock: {
                    increment:
                      numericQuantity
                  }
                }
              });

            await tx.auditLog.create({
              data: {
                merchantId,
                actorUserId: null,
                action:
                  "PRODUCT_RESTOCKED",
                entityType: "PRODUCT",
                entityId: product.id,
                metadata: {
                  productName:
                    product.name,
                  quantityAdded:
                    numericQuantity,
                  previousStock:
                    product.stock,
                  newStock:
                    updatedProduct.stock,
                  note: trimmedNote
                }
              }
            });

            return updatedProduct;
          }
        );

      if (!result) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      res.json({
        message:
          "Product restocked successfully",
        product: result,
        quantityAdded:
          numericQuantity
      });
    } catch (error) {
      console.error(
        "Failed to restock product:",
        error
      );

      res.status(500).json({
        error:
          "Failed to restock product"
      });
    }
  }
);

/*
 * --------------------------------------------------------------------------
 * PRODUCT IMAGES
 * --------------------------------------------------------------------------
 */

/**
 * Add an image to a product.
 *
 * POST /merchants/:merchantId/products/:productId/images
 *
 * Body:
 * {
 *   "url": "https://example.com/product.jpg",
 *   "altText": "Product photo",
 *   "sortOrder": 0,
 *   "isPrimary": true
 * }
 */
router.post(
  "/:merchantId/products/:productId/images",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId
      } = req.params;

      const {
        url,
        altText,
        sortOrder,
        isPrimary
      } = req.body;

      if (!isValidImageUrl(url)) {
        res.status(400).json({
          error:
            "url must be a valid HTTP or HTTPS URL"
        });
        return;
      }

      if (
        altText !== undefined &&
        altText !== null &&
        typeof altText !== "string"
      ) {
        res.status(400).json({
          error:
            "altText must be a string"
        });
        return;
      }

      const trimmedAltText =
        typeof altText === "string" &&
        altText.trim().length > 0
          ? altText.trim()
          : null;

      if (
        trimmedAltText &&
        trimmedAltText.length >
          IMAGE_ALT_TEXT_MAX_LENGTH
      ) {
        res.status(400).json({
          error:
            `altText must be ${IMAGE_ALT_TEXT_MAX_LENGTH} characters or fewer`
        });
        return;
      }

      const numericSortOrder =
        sortOrder === undefined
          ? 0
          : Number(sortOrder);

      if (
        !Number.isInteger(
          numericSortOrder
        ) ||
        numericSortOrder < 0
      ) {
        res.status(400).json({
          error:
            "sortOrder must be a non-negative integer"
        });
        return;
      }

      if (
        isPrimary !== undefined &&
        typeof isPrimary !== "boolean"
      ) {
        res.status(400).json({
          error:
            "isPrimary must be a boolean"
        });
        return;
      }

      const product =
        await prisma.product.findFirst({
          where: {
            id: productId,
            merchantId
          }
        });

      if (!product) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      const image =
        await prisma.$transaction(
          async (tx) => {
            const makePrimary =
              isPrimary === true;

            if (makePrimary) {
              await tx.productImage.updateMany({
                where: {
                  productId
                },
                data: {
                  isPrimary: false
                }
              });
            }

            return tx.productImage.create({
              data: {
                productId,
                url: url.trim(),
                altText:
                  trimmedAltText,
                sortOrder:
                  numericSortOrder,
                isPrimary:
                  makePrimary
              }
            });
          }
        );

      res.status(201).json(image);
    } catch (error) {
      console.error(
        "Failed to add product image:",
        error
      );

      res.status(500).json({
        error:
          "Failed to add product image"
      });
    }
  }
);

/**
 * List product images.
 *
 * GET /merchants/:merchantId/products/:productId/images
 */
router.get(
  "/:merchantId/products/:productId/images",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId
      } = req.params;

      const product =
        await prisma.product.findFirst({
          where: {
            id: productId,
            merchantId
          },
          select: {
            id: true
          }
        });

      if (!product) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      const images =
        await prisma.productImage.findMany({
          where: {
            productId
          },
          orderBy: [
            {
              isPrimary: "desc"
            },
            {
              sortOrder: "asc"
            }
          ]
        });

      res.json(images);
    } catch (error) {
      console.error(
        "Failed to list product images:",
        error
      );

      res.status(500).json({
        error:
          "Failed to list product images"
      });
    }
  }
);

/**
 * Set a product image as primary.
 *
 * PATCH /merchants/:merchantId/products/:productId/images/:imageId/primary
 */
router.patch(
  "/:merchantId/products/:productId/images/:imageId/primary",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId,
        imageId
      } = req.params;

      const product =
        await prisma.product.findFirst({
          where: {
            id: productId,
            merchantId
          },
          select: {
            id: true
          }
        });

      if (!product) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      const image =
        await prisma.productImage.findFirst({
          where: {
            id: imageId,
            productId
          }
        });

      if (!image) {
        res.status(404).json({
          error: "Product image not found"
        });
        return;
      }

      const updatedImage =
        await prisma.$transaction(
          async (tx) => {
            await tx.productImage.updateMany({
              where: {
                productId
              },
              data: {
                isPrimary: false
              }
            });

            return tx.productImage.update({
              where: {
                id: image.id
              },
              data: {
                isPrimary: true
              }
            });
          }
        );

      res.json(updatedImage);
    } catch (error) {
      console.error(
        "Failed to set primary product image:",
        error
      );

      res.status(500).json({
        error:
          "Failed to set primary product image"
      });
    }
  }
);

/**
 * Delete a product image.
 *
 * DELETE /merchants/:merchantId/products/:productId/images/:imageId
 */
router.delete(
  "/:merchantId/products/:productId/images/:imageId",
  async (req, res) => {
    try {
      const {
        merchantId,
        productId,
        imageId
      } = req.params;

      const product =
        await prisma.product.findFirst({
          where: {
            id: productId,
            merchantId
          },
          select: {
            id: true
          }
        });

      if (!product) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      const image =
        await prisma.productImage.findFirst({
          where: {
            id: imageId,
            productId
          }
        });

      if (!image) {
        res.status(404).json({
          error:
            "Product image not found"
        });
        return;
      }

      await prisma.productImage.delete({
        where: {
          id: image.id
        }
      });

      res.json({
        message:
          "Product image deleted successfully"
      });
    } catch (error) {
      console.error(
        "Failed to delete product image:",
        error
      );

      res.status(500).json({
        error:
          "Failed to delete product image"
      });
    }
  }
);

export default router;