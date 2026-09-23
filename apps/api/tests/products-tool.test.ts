import {
    ProductStatus,
    prisma
} from "@ethio-commerce/database";
import {
    afterAll,
    beforeEach,
    describe,
    expect,
    it
} from "vitest";

import {
    getProduct,
    searchProducts
} from "../src/tools/products.js";

import {
    executeAITool
} from "../src/ai/ai-tool-executor.js";

const testPrefix =
    "products-tool";

async function cleanup() {
    const merchants =
        await prisma.merchant.findMany({
            where: {
                name: {
                    startsWith:
                        testPrefix
                }
            },
            select: {
                id: true
            }
        });

    const merchantIds =
        merchants.map(
            (merchant) =>
                merchant.id
        );

    if (merchantIds.length === 0) {
        return;
    }

    await prisma.productImage.deleteMany({
        where: {
            product: {
                merchantId: {
                    in: merchantIds
                }
            }
        }
    });

    await prisma.product.deleteMany({
        where: {
            merchantId: {
                in: merchantIds
            }
        }
    });

    await prisma.productCategory.deleteMany({
        where: {
            merchantId: {
                in: merchantIds
            }
        }
    });

    await prisma.merchant.deleteMany({
        where: {
            id: {
                in: merchantIds
            }
        }
    });
}

async function createFixture() {
    const merchant =
        await prisma.merchant.create({
            data: {
                name:
                    `${testPrefix}-merchant`,
                currency:
                    "ETB"
            }
        });

    const category =
        await prisma.productCategory.create({
            data: {
                merchantId:
                    merchant.id,
                name:
                    "Traditional Ethiopian Dress",
                imageUrl:
                    "https://example.test/category-dress.jpg",
                imageAltText:
                    "Traditional Ethiopian dresses"
            }
        });

    const product =
        await prisma.product.create({
            data: {
                merchantId:
                    merchant.id,
                categoryId:
                    category.id,
                name:
                    "White Habesha Kemis",
                description:
                    "Traditional embroidered dress",
                price:
                    "2500.00",
                currency:
                    "ETB",
                stock:
                    4,
                status:
                    ProductStatus.ACTIVE
            }
        });

    await prisma.productImage.create({
        data: {
            productId:
                product.id,
            url:
                "https://example.test/white-habesha-kemis.jpg",
            altText:
                "White Habesha Kemis",
            isPrimary:
                true
        }
    });

    return {
        merchant,
        category,
        product
    };
}

beforeEach(async () => {
    await cleanup();
});

afterAll(async () => {
    await cleanup();
});

describe("product commerce tools", () => {
    it("searches active products by product name and returns the product image", async () => {
        const {
            merchant,
            product
        } =
            await createFixture();

        const results =
            await searchProducts(
                merchant.id,
                "White Habesha"
            );

        expect(results).toHaveLength(1);

        expect(results[0]).toEqual(
            expect.objectContaining({
                id:
                    product.id,
                name:
                    "White Habesha Kemis",
                price:
                    2500,
                currency:
                    "ETB",
                stock:
                    4,
                imageUrl:
                    "https://example.test/white-habesha-kemis.jpg"
            })
        );
    });

    it("gets an active product by id and returns its product image", async () => {
        const {
            merchant,
            product
        } =
            await createFixture();

        const result =
            await getProduct(
                merchant.id,
                product.id
            );

        expect(result).toEqual(
            expect.objectContaining({
                id:
                    product.id,
                name:
                    "White Habesha Kemis",
                imageUrl:
                    "https://example.test/white-habesha-kemis.jpg",
                category: {
                    id:
                        expect.any(String),
                    name:
                        "Traditional Ethiopian Dress",
                    imageUrl:
                        "https://example.test/category-dress.jpg",
                    imageAltText:
                        "Traditional Ethiopian dresses"
                }
            })
        );
    });

    it("searches active products by category name", async () => {
        const {
            merchant,
            product
        } =
            await createFixture();

        const results =
            await searchProducts(
                merchant.id,
                "Traditional Ethiopian Dress"
            );

        expect(results).toHaveLength(1);

        expect(results[0]).toEqual(
            expect.objectContaining({
                id:
                    product.id,
                name:
                    "White Habesha Kemis",
                imageUrl:
                    "https://example.test/white-habesha-kemis.jpg",
                category: {
                    id:
                        expect.any(String),
                    name:
                        "Traditional Ethiopian Dress",
                    imageUrl:
                        "https://example.test/category-dress.jpg",
                    imageAltText:
                        "Traditional Ethiopian dresses"
                }
            })
        );
    });

    it("excludes inactive products from category searches", async () => {
        const {
            merchant,
            category
        } =
            await createFixture();

        await prisma.product.create({
            data: {
                merchantId:
                    merchant.id,
                categoryId:
                    category.id,
                name:
                    "Archived Habesha Kemis",
                price:
                    "1800.00",
                currency:
                    "ETB",
                stock:
                    3,
                status:
                    ProductStatus.ARCHIVED
            }
        });

        const results =
            await searchProducts(
                merchant.id,
                "Traditional Ethiopian Dress"
            );

        expect(results).toHaveLength(1);

        expect(
            results.map(
                (product) => product.name
            )
        ).toEqual([
            "White Habesha Kemis"
        ]);
    });

    it("does not return products from another merchant when searching by category name", async () => {
        const {
            merchant
        } =
            await createFixture();

        const otherMerchant =
            await prisma.merchant.create({
                data: {
                    name:
                        `${testPrefix}-other-merchant`
                }
            });

        const otherCategory =
            await prisma.productCategory.create({
                data: {
                    merchantId:
                        otherMerchant.id,
                    name:
                        "Traditional Ethiopian Dress",
                    imageUrl:
                        "https://example.test/other-category.jpg",
                    imageAltText:
                        "Other merchant category"
                }
            });

        await prisma.product.create({
            data: {
                merchantId:
                    otherMerchant.id,
                categoryId:
                    otherCategory.id,
                name:
                    "Other Merchant Habesha Kemis",
                price:
                    "3200.00",
                currency:
                    "ETB",
                stock:
                    6,
                status:
                    ProductStatus.ACTIVE
            }
        });

        const results =
            await searchProducts(
                merchant.id,
                "Traditional Ethiopian Dress"
            );

        expect(results).toHaveLength(1);

        expect(
            results.map(
                (product) => product.name
            )
        ).toEqual([
            "White Habesha Kemis"
        ]);
    });

    it("preserves the normalized query in searchProducts tool execution results", async () => {
        const {
            merchant
        } =
            await createFixture();

        const execution =
            await executeAITool(
                {
                    tool:
                        "searchProducts",
                    arguments: {
                        query:
                            "  Traditional Ethiopian Dress  "
                    }
                },
                {
                    merchantId:
                        merchant.id,
                    customerId:
                        "test-customer"
                }
            );

        expect(execution.tool).toBe(
            "searchProducts"
        );

        expect(execution.query).toBe(
            "Traditional Ethiopian Dress"
        );

        expect(
            Array.isArray(execution.result)
        ).toBe(true);
    });

    it(
        "does not currently bridge an Amharic search query to an English-only catalog",
        async () => {
            const {
                merchant,
                category,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Urban Classic",
                    description:
                        "Black leather everyday shoe"
                }
            });

            await prisma.productCategory.update({
                where: {
                    id: category.id
                },
                data: {
                    name:
                        "Men Shoes"
                }
            });

            const execution =
                await executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "áŒ«áˆ›"
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                );

            expect(execution.query).toBe(
                "áŒ«áˆ›"
            );

            expect(execution.result).toEqual(
                []
            );
        }
    );

    it(
        "does not currently bridge an English search query to an Amharic-only catalog",
        async () => {
            const {
                merchant,
                category,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "á‹¨áŠ¨á‰°áˆ› áŒ«áˆ›",
                    description:
                        "áŒ¥á‰áˆ­ á‹¨á‰†á‹³ áŒ«áˆ›"
                }
            });

            await prisma.productCategory.update({
                where: {
                    id: category.id
                },
                data: {
                    name:
                        "á‹¨á‹ˆáŠ•á‹µ áŒ«áˆ›"
                }
            });

            const execution =
                await executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "shoes"
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                );

            expect(execution.query).toBe(
                "shoes"
            );

            expect(execution.result).toEqual(
                []
            );
        }
    );

    it(
        "searches meaning-equivalent multilingual queries and deduplicates authoritative products",
        async () => {
            const {
                merchant,
                category,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Urban Classic",
                    description:
                        "Black leather everyday shoe"
                }
            });

            await prisma.productCategory.update({
                where: {
                    id: category.id
                },
                data: {
                    name:
                        "Men Shoes"
                }
            });

            const execution =
                await executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "áŒ¥á‰áˆ­ á‹¨á‹ˆáŠ•á‹µ áŒ«áˆ›",
                            alternativeQueries: [
                                "black men shoes"
                            ]
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                );

            expect(execution.result).toEqual([
                expect.objectContaining({
                    id:
                        product.id,
                    name:
                        "Urban Classic"
                })
            ]);
        }
    );

    it(
        "rejects excessive multilingual alternative search queries",
        async () => {
            const {
                merchant
            } =
                await createFixture();

            await expect(
                executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "shoes",
                            alternativeQueries: [
                                "áŒ«áˆ›",
                                "chama",
                                "men shoes",
                                "everyday shoes"
                            ]
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                )
            ).rejects.toThrow(
                'AI tool argument "alternativeQueries" must contain at most 3 queries.'
            );
        }
    );

    it(
        "rejects excessively long AI-generated catalog search queries",
        async () => {
            const {
                merchant
            } =
                await createFixture();

            await expect(
                executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "x".repeat(501)
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                )
            ).rejects.toThrow(
                'AI tool argument "query" must be at most 500 characters.'
            );

            await expect(
                executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "shoes",
                            alternativeQueries: [
                                "x".repeat(501)
                            ]
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                )
            ).rejects.toThrow(
                'AI tool argument "alternativeQueries" entries must be at most 500 characters.'
            );
        }
    );

    it(
        "applies validated maximum price and currency through AI product search",
        async () => {
            const {
                merchant,
                category,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Budget Men Shoes",
                    description:
                        "Everyday shoes",
                    price:
                        "1800.00",
                    currency:
                        "ETB"
                }
            });

            const expensiveProduct =
                await prisma.product.create({
                    data: {
                        merchantId:
                            merchant.id,
                        categoryId:
                            category.id,
                        name:
                            "Premium Men Shoes",
                        description:
                            "Formal shoes",
                        price:
                            "2400.00",
                        currency:
                            "ETB",
                        stock: 2,
                        status:
                            ProductStatus.ACTIVE
                    }
                });

            const execution =
                await executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "Men Shoes",
                            maxPrice: 2000,
                            currency:
                                "ETB"
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                );

            const results =
                execution.result as Array<{
                    id: string;
                    price: number;
                    currency: string;
                }>;

            expect(
                results.map(
                    (result) => result.id
                )
            ).toEqual([
                product.id
            ]);

            expect(
                results.some(
                    (result) =>
                        result.id ===
                        expensiveProduct.id
                )
            ).toBe(false);
        }
    );

    it(
        "applies trusted product exclusions through AI product search",
        async () => {
            const {
                merchant,
                category,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Budget Men Shoes",
                    description:
                        "Everyday shoes",
                    price:
                        "1800.00",
                    currency:
                        "ETB"
                }
            });

            const alternativeProduct =
                await prisma.product.create({
                    data: {
                        merchantId:
                            merchant.id,
                        categoryId:
                            category.id,
                        name:
                            "Classic Men Shoes",
                        description:
                            "Classic everyday shoes",
                        price:
                            "1950.00",
                        currency:
                            "ETB",
                        stock: 3,
                        status:
                            ProductStatus.ACTIVE
                    }
                });

            const execution =
                await executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "Men Shoes",
                            alternativeQueries: [
                                "Shoes Men"
                            ],
                            maxPrice: 2000,
                            currency:
                                "ETB"
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer",
                        excludeProductIds: [
                            product.id
                        ]
                    }
                );

            const results =
                execution.result as Array<{
                    id: string;
                }>;

            expect(
                results.map(
                    (result) => result.id
                )
            ).toEqual([
                alternativeProduct.id
            ]);

            expect(
                execution.searchContext
            ).toEqual({
                query:
                    "Men Shoes",
                maxPrice:
                    2000,
                currency:
                    "ETB"
            });
        }
    );

    it(
        "rejects invalid AI-generated maximum product prices",
        async () => {
            const {
                merchant
            } =
                await createFixture();

            for (
                const maxPrice of [
                    0,
                    -1,
                    Number.NaN,
                    Number.POSITIVE_INFINITY,
                    "2000"
                ]
            ) {
                await expect(
                    executeAITool(
                        {
                            tool:
                                "searchProducts",
                            arguments: {
                                query:
                                    "Men Shoes",
                                maxPrice,
                                currency:
                                    "ETB"
                            }
                        },
                        {
                            merchantId:
                                merchant.id,
                            customerId:
                                "test-customer"
                        }
                    )
                ).rejects.toThrow(
                    'AI tool argument "maxPrice" must be a positive finite number.'
                );
            }
        }
    );

    it(
        "requires currency when AI product search includes a maximum price",
        async () => {
            const {
                merchant
            } =
                await createFixture();

            await expect(
                executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "Men Shoes",
                            maxPrice:
                                2000
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                )
            ).rejects.toThrow(
                'AI tool argument "currency" is required when "maxPrice" is provided.'
            );
        }
    );

    it(
        "rejects invalid AI-generated product search currencies",
        async () => {
            const {
                merchant
            } =
                await createFixture();

            for (
                const currency of [
                    "",
                    "ET",
                    "ETBB",
                    "12A",
                    123
                ]
            ) {
                await expect(
                    executeAITool(
                        {
                            tool:
                                "searchProducts",
                            arguments: {
                                query:
                                    "Men Shoes",
                                maxPrice:
                                    2000,
                                currency
                            }
                        },
                        {
                            merchantId:
                                merchant.id,
                            customerId:
                                "test-customer"
                        }
                    )
                ).rejects.toThrow(
                    'AI tool argument "currency" must be a 3-letter currency code.'
                );
            }
        }
    );

    it(
        "normalizes AI-generated product search currency before filtering",
        async () => {
            const {
                merchant,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Budget Men Shoes",
                    price:
                        "1800.00",
                    currency:
                        "ETB"
                }
            });

            const execution =
                await executeAITool(
                    {
                        tool:
                            "searchProducts",
                        arguments: {
                            query:
                                "Men Shoes",
                            maxPrice:
                                2000,
                            currency:
                                " etb "
                        }
                    },
                    {
                        merchantId:
                            merchant.id,
                        customerId:
                            "test-customer"
                    }
                );

            const results =
                execution.result as Array<{
                    id: string;
                    price: number;
                    currency: string;
                }>;

            expect(results).toHaveLength(1);

            expect(results[0]).toMatchObject({
                id:
                    product.id,
                price:
                    1800,
                currency:
                    "ETB"
            });

            expect(
                execution.searchContext
            ).toEqual({
                query:
                    "Men Shoes",
                maxPrice:
                    2000,
                currency:
                    "ETB"
            });
        }
    );

    it(
        "searches active products by merchant-entered product description",
        async () => {
            const {
                merchant,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Urban Classic",
                    description:
                        "Black leather everyday shoe for men"
                }
            });

            const results =
                await searchProducts(
                    merchant.id,
                    "leather"
                );

            expect(results).toHaveLength(1);

            expect(results[0]).toMatchObject({
                id:
                    product.id,
                name:
                    "Urban Classic",
                description:
                    "Black leather everyday shoe for men",
                price: 2500,
                currency:
                    "ETB",
                stock: 4
            });
        }
    );

    it(
        "matches a multi-term product query when its terms are distributed across authoritative catalog fields",
        async () => {
            const {
                merchant,
                category,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Urban Classic",
                    description:
                        "Black leather everyday shoe"
                }
            });

            await prisma.productCategory.update({
                where: {
                    id: category.id
                },
                data: {
                    name:
                        "Men Shoes"
                }
            });

            const results =
                await searchProducts(
                    merchant.id,
                    "black men shoes"
                );

            expect(results).toHaveLength(1);

            expect(results[0]).toMatchObject({
                id:
                    product.id,
                name:
                    "Urban Classic",
                description:
                    "Black leather everyday shoe",
                price: 2500,
                currency:
                    "ETB",
                stock: 4,
                category: {
                    id:
                        category.id,
                    name:
                        "Men Shoes"
                }
            });
        }
    );

    it(
        "does not return a product when only some multi-term query constraints match",
        async () => {
            const {
                merchant,
                category,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Urban Classic",
                    description:
                        "Black leather everyday accessory"
                }
            });

            await prisma.productCategory.update({
                where: {
                    id: category.id
                },
                data: {
                    name:
                        "Accessories"
                }
            });

            const results =
                await searchProducts(
                    merchant.id,
                    "black men shoes"
                );

            expect(results).toEqual([]);
        }
    );

    it(
        "filters matching active products by maximum price and currency",
        async () => {
            const {
                merchant,
                category,
                product
            } =
                await createFixture();

            await prisma.product.update({
                where: {
                    id: product.id
                },
                data: {
                    name:
                        "Budget Men Shoes",
                    description:
                        "Everyday shoes",
                    price:
                        "1800.00",
                    currency:
                        "ETB"
                }
            });

            const expensiveProduct =
                await prisma.product.create({
                    data: {
                        merchantId:
                            merchant.id,
                        categoryId:
                            category.id,
                        name:
                            "Premium Men Shoes",
                        description:
                            "Formal shoes",
                        price:
                            "2400.00",
                        currency:
                            "ETB",
                        stock: 2,
                        status:
                            ProductStatus.ACTIVE
                    }
                });

            const differentCurrencyProduct =
                await prisma.product.create({
                    data: {
                        merchantId:
                            merchant.id,
                        categoryId:
                            category.id,
                        name:
                            "USD Men Shoes",
                        description:
                            "Imported shoes",
                        price:
                            "20.00",
                        currency:
                            "USD",
                        stock: 3,
                        status:
                            ProductStatus.ACTIVE
                    }
                });

            const alternativeProduct =
                await prisma.product.create({
                    data: {
                        merchantId:
                            merchant.id,
                        categoryId:
                            category.id,
                        name:
                            "Classic Men Shoes",
                        description:
                            "Classic everyday shoes",
                        price:
                            "1950.00",
                        currency:
                            "ETB",
                        stock: 3,
                        status:
                            ProductStatus.ACTIVE
                    }
                });

            const results =
                await searchProducts(
                    merchant.id,
                    "Men Shoes",
                    {
                        maxPrice: 2000,
                        currency: "ETB",
                        excludeProductIds: [
                            product.id
                        ]
                    }
                );

            expect(
                results.map(
                    (result) => result.id
                )
            ).toEqual([
                alternativeProduct.id
            ]);

            expect(
                results.some(
                    (result) =>
                        result.id ===
                        expensiveProduct.id
                )
            ).toBe(false);

            expect(
                results.some(
                    (result) =>
                        result.id ===
                        differentCurrencyProduct.id
                )
            ).toBe(false);
        }
    );
});
