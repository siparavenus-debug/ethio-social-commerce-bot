import {
    understandCustomerMessage
} from "../ai/ai-orchestrator.js";

type EvaluationCase = {
    id: string;
    language:
    | "english"
    | "amharic"
    | "code-switch"
    | "transliterated";
    input: string;
    expectedIntent: string;
    expectedTool:
    | string
    | null;
    expectedQueryTerms?: string[];
    forbiddenQueryTerms?: string[];
    candidateProducts?: Array<{
        id: string;
        name: string;
    }>;
    expectedProductId?: string;
};

const cases: EvaluationCase[] = [
    {
        id: "english-product-search",
        language: "english",
        input:
            "Do you have men's shoes?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "men",
            "shoe"
        ]
    },
    {
        id: "amharic-product-search",
        language: "amharic",
        input:
            "የወንድ ጫማ አለ?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "men",
            "shoe"
        ]
    },
    {
        id: "code-switch-product-search",
        language: "code-switch",
        input:
            "black የወንድ shoe አለ?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "black",
            "men",
            "shoe"
        ],
        forbiddenQueryTerms: [
            "nike",
            "leather",
            "women",
            "white"
        ]
    },
    {
        id: "code-switch-multiple-constraints",
        language: "code-switch",
        input:
            "black leather የወንድ shoe አለ?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "black",
            "leather",
            "men",
            "shoe"
        ],
        forbiddenQueryTerms: [
            "nike",
            "women",
            "white",
            "adidas"
        ]
    },
    {
        id: "transliterated-product-search",
        language: "transliterated",
        input:
            "mens shoe ale?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "men",
            "shoe"
        ],
        forbiddenQueryTerms: [
            "ale"
        ]
    },
    {
        id: "transliterated-color-product-search",
        language: "transliterated",
        input:
            "black chama ale?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "black",
            "shoe"
        ],
        forbiddenQueryTerms: [
            "men",
            "women",
            "nike",
            "leather"
        ]
    },
    {
        id: "transliterated-shoe-search",
        language: "transliterated",
        input:
            "chama ale?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "shoe"
        ],
        forbiddenQueryTerms: [
            "ale",
            "men",
            "women",
            "black",
            "nike"
        ]
    },
    {
        id: "transliterated-shoe-fragment",
        language: "transliterated",
        input:
            "chama",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "shoe"
        ],
        forbiddenQueryTerms: [
            "men",
            "women",
            "black",
            "nike"
        ]
    },
    {
        id: "transliterated-english-product-filler",
        language: "transliterated",
        input:
            "shoe ale?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "shoe"
        ],
        forbiddenQueryTerms: [
            "ale",
            "sale",
            "sales",
            "men",
            "women",
            "black",
            "nike"
        ]
    },
    {
        id: "transliterated-color-shoe-fragment",
        language: "transliterated",
        input:
            "black chama",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "black",
            "shoe"
        ],
        forbiddenQueryTerms: [
            "men",
            "women",
            "nike",
            "leather"
        ]
    },
    {
        id: "code-switch-fragment-search",
        language: "code-switch",
        input:
            "black ጫማ",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "black",
            "shoe"
        ],
        forbiddenQueryTerms: [
            "men",
            "women",
            "nike",
            "leather"
        ]
    },
    {
        id: "amharic-product-fragment",
        language: "amharic",
        input:
            "ጫማ",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: [
            "shoe"
        ],
        forbiddenQueryTerms: [
            "men",
            "women",
            "black",
            "nike"
        ]
    },
    {
        id: "english-ordinal-candidate-reference",
        language: "english",
        input:
            "the second one",
        expectedIntent:
            "GET_PRODUCT",
        expectedTool:
            "getProduct",
        candidateProducts: [
            {
                id:
                    "candidate-white",
                name:
                    "White Habesha Kemis"
            },
            {
                id:
                    "candidate-blue",
                name:
                    "Blue Habesha Kemis"
            }
        ],
        expectedProductId:
            "candidate-blue"
    },
    {
        id:
            "english-exact-name-candidate-reference",
        language:
            "english",
        input:
            "Blue Habesha Kemis",
        expectedIntent:
            "GET_PRODUCT",
        expectedTool:
            "getProduct",
        candidateProducts: [
            {
                id:
                    "candidate-white",
                name:
                    "White Habesha Kemis"
            },
            {
                id:
                    "candidate-blue",
                name:
                    "Blue Habesha Kemis"
            }
        ],
        expectedProductId:
            "candidate-blue"
    },
    {
        id:
            "english-descriptive-candidate-reference",
        language:
            "english",
        input:
            "the blue one",
        expectedIntent:
            "GET_PRODUCT",
        expectedTool:
            "getProduct",
        candidateProducts: [
            {
                id:
                    "candidate-white",
                name:
                    "White Habesha Kemis"
            },
            {
                id:
                    "candidate-blue",
                name:
                    "Blue Habesha Kemis"
            }
        ],
        expectedProductId:
            "candidate-blue"
    },
    {
        id:
            "english-ambiguous-candidate-reference",
        language:
            "english",
        input:
            "the blue one",
        expectedIntent:
            "GET_PRODUCT",
        expectedTool:
            null,
        candidateProducts: [
            {
                id:
                    "candidate-blue-small",
                name:
                    "Blue Small Habesha Kemis"
            },
            {
                id:
                    "candidate-blue-large",
                name:
                    "Blue Large Habesha Kemis"
            }
        ]
    },
    {
        id: "transliterated-ambiguous-reference",
        language: "transliterated",
        input:
            "ya one",
        expectedIntent:
            "GENERAL",
        expectedTool:
            null
    },
    {
        id: "broad-catalog-request",
        language: "english",
        input:
            "What products do you have?",
        expectedIntent:
            "SEARCH_PRODUCT",
        expectedTool:
            "searchProducts",
        expectedQueryTerms: []
    },
    {
        id: "ambiguous-reference",
        language: "code-switch",
        input:
            "ያኛው one",
        expectedIntent:
            "GENERAL",
        expectedTool:
            null
    }
];

function normalize(value: string): string {
    return value
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function queryContainsExpectedTerm(
    query: string,
    expectedTerm: string
): boolean {
    const normalizedQuery =
        normalize(query);

    const normalizedExpected =
        normalize(expectedTerm);

    if (
        !normalizedQuery ||
        !normalizedExpected
    ) {
        return false;
    }

    return normalizedQuery
        .split(/\s+/)
        .some(
            (queryTerm) =>
                queryTerm === normalizedExpected ||
                queryTerm.startsWith(
                    normalizedExpected
                ) ||
                normalizedExpected.startsWith(
                    queryTerm
                )
        );
}

async function evaluateCase(
    evaluationCase: EvaluationCase
) {
    const response =
        await understandCustomerMessage({
            text:
                evaluationCase.input,
            state: {
                candidateProducts:
                    evaluationCase
                        .candidateProducts
            },
            merchantName:
                "Multilingual Evaluation Merchant"
        });

    const firstToolCall =
        response.toolCalls[0];

    const actualTool =
        firstToolCall?.tool ?? null;

    const actualQuery =
        typeof firstToolCall?.arguments
            ?.query === "string"
            ? firstToolCall.arguments.query
            : null;

    const actualAlternativeQueries =
        Array.isArray(
            firstToolCall?.arguments
                ?.alternativeQueries
        )
            ? firstToolCall.arguments
                .alternativeQueries.filter(
                    (
                        alternativeQuery
                    ): alternativeQuery is string =>
                        typeof alternativeQuery ===
                        "string"
                )
            : [];

    const actualSearchQueries =
        actualQuery === null
            ? []
            : [
                actualQuery,
                ...actualAlternativeQueries
            ];

    const intentPass =
        response.intent ===
        evaluationCase.expectedIntent;

    const toolPass =
        actualTool ===
        evaluationCase.expectedTool;

    const actualProductId =
        typeof firstToolCall?.arguments
            ?.productId === "string"
            ? firstToolCall.arguments.productId
            : null;

    const productIdPass =
        evaluationCase.expectedProductId ===
            undefined
            ? true
            : actualProductId ===
            evaluationCase.expectedProductId;

    let queryPass = true;

    if (
        evaluationCase.expectedQueryTerms
        !== undefined
    ) {
        if (actualQuery === null) {
            queryPass = false;
        } else if (
            evaluationCase.expectedQueryTerms
                .length === 0
        ) {
            queryPass =
                actualQuery.trim() === "";
        } else {
            queryPass =
                actualSearchQueries.some(
                    (searchQuery) =>
                        evaluationCase
                            .expectedQueryTerms!
                            .every(
                                (expectedTerm) =>
                                    queryContainsExpectedTerm(
                                        searchQuery,
                                        expectedTerm
                                    )
                            )
                );
        }
    }

    let forbiddenQueryTermsPass = true;

    if (
        evaluationCase.forbiddenQueryTerms
        !== undefined
    ) {
        if (actualQuery === null) {
            forbiddenQueryTermsPass = true;
        } else {
            forbiddenQueryTermsPass =
                actualSearchQueries.every(
                    (searchQuery) =>
                        evaluationCase
                            .forbiddenQueryTerms!
                            .every(
                                (forbiddenTerm) =>
                                    !queryContainsExpectedTerm(
                                        searchQuery,
                                        forbiddenTerm
                                    )
                            )
                );
        }
    }

    return {
        id:
            evaluationCase.id,
        language:
            evaluationCase.language,
        input:
            evaluationCase.input,
        expected: {
            intent:
                evaluationCase.expectedIntent,
            tool:
                evaluationCase.expectedTool,
            queryTerms:
                evaluationCase.expectedQueryTerms ??
                null,
            forbiddenQueryTerms:
                evaluationCase.forbiddenQueryTerms ??
                null,
            productId:
                evaluationCase.expectedProductId ??
                null
        },
        actual: {
            intent:
                response.intent,
            tool:
                actualTool,
            query:
                actualQuery,
            alternativeQueries:
                actualAlternativeQueries,
            productId:
                actualProductId,
            message:
                response.message,
            toolCallCount:
                response.toolCalls.length
        },
        checks: {
            intent:
                intentPass,
            tool:
                toolPass,
            query:
                queryPass,
            forbiddenQueryTerms:
                forbiddenQueryTermsPass,
            productId:
                productIdPass
        },
        pass:
            intentPass &&
            toolPass &&
            queryPass &&
            forbiddenQueryTermsPass &&
            productIdPass
    };
}

async function main() {
    console.log(
        "LIVE MULTILINGUAL AI EVALUATION"
    );

    console.log(
        "This calls the configured Anthropic model."
    );

    console.log(
        "Commerce tools are NOT executed.\n"
    );

    const results = [];

    for (const evaluationCase of cases) {
        try {
            const result =
                await evaluateCase(
                    evaluationCase
                );

            results.push(result);

            console.log(
                JSON.stringify(
                    result,
                    null,
                    2
                )
            );
        } catch (error) {
            const result = {
                id:
                    evaluationCase.id,
                language:
                    evaluationCase.language,
                input:
                    evaluationCase.input,
                pass: false,
                error:
                    error instanceof Error
                        ? error.message
                        : String(error)
            };

            results.push(result);

            console.log(
                JSON.stringify(
                    result,
                    null,
                    2
                )
            );
        }

        console.log("");
    }

    const passed =
        results.filter(
            (result) =>
                result.pass
        ).length;

    const failed =
        results.length - passed;

    console.log(
        `SUMMARY: ${passed}/${results.length} passed, ${failed} review required.`
    );

    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(
        "Evaluation failed:",
        error
    );

    process.exitCode = 1;
});