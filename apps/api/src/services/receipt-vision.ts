import {
    GoogleGenAI,
    Type
  } from "@google/genai";
  
  import { env } from "../config/env.js";
  
  export type ReceiptExtraction = {
    provider: string | null;
    transactionReference: string | null;
    amount: number | null;
    currency: string | null;
    transactionDate: string | null;
    transactionTime: string | null;
    senderName: string | null;
    senderAccount: string | null;
    confidence: number;
  };
  
  let geminiClient: GoogleGenAI | null = null;
  
  function getGeminiClient(): GoogleGenAI {
    if (!env.geminiApiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured"
      );
    }
  
    if (!geminiClient) {
      geminiClient = new GoogleGenAI({
        apiKey: env.geminiApiKey
      });
    }
  
    return geminiClient;
  }
  
  const receiptSchema = {
    type: Type.OBJECT,
    properties: {
      provider: {
        type: Type.STRING,
        nullable: true
      },
  
      transactionReference: {
        type: Type.STRING,
        nullable: true
      },
  
      amount: {
        type: Type.NUMBER,
        nullable: true
      },
  
      currency: {
        type: Type.STRING,
        nullable: true
      },
  
      transactionDate: {
        type: Type.STRING,
        nullable: true
      },
  
      transactionTime: {
        type: Type.STRING,
        nullable: true
      },
  
      senderName: {
        type: Type.STRING,
        nullable: true
      },
  
      senderAccount: {
        type: Type.STRING,
        nullable: true
      },
  
      confidence: {
        type: Type.NUMBER
      }
    },
  
    required: [
      "provider",
      "transactionReference",
      "amount",
      "currency",
      "transactionDate",
      "transactionTime",
      "senderName",
      "senderAccount",
      "confidence"
    ]
  };
  
  export async function extractReceipt(
    image: Buffer,
    mimeType = "image/jpeg"
  ): Promise<ReceiptExtraction> {
    const client =
      getGeminiClient();
  
    const response =
      await client.models.generateContent({
        model: "gemini-3.6-flash",
  
        contents: [
          {
            inlineData: {
              mimeType,
              data: image.toString("base64")
            }
          },
  
          {
            text: `
  You are extracting payment information from an
  Ethiopian mobile-money payment receipt.
  
  Read the receipt image carefully.
  
  Extract only information that is visibly present.
  
  Possible providers include:
  - Telebirr
  - CBE Birr
  - Other Ethiopian payment providers
  
  Rules:
  
  1. Never invent a transaction reference.
  2. Never invent an amount.
  3. Never invent a currency.
  4. Never invent a date or time.
  5. If a field cannot be read reliably, return null.
  6. Preserve the transaction reference exactly as displayed.
  7. Amount must be numeric only.
  8. Currency should normally be "ETB" when explicitly shown.
  9. confidence must be between 0 and 1.
  10. Do not decide whether the payment is genuine.
  11. Do not decide whether the payment should be approved.
  
  Return only the requested structured data.
  `
          }
        ],
  
        config: {
          responseMimeType:
            "application/json",
  
          responseSchema:
            receiptSchema
        }
      });
  
    const text =
      response.text?.trim();
  
    if (!text) {
      throw new Error(
        "Gemini receipt extraction returned an empty response"
      );
    }
  
    let parsed: unknown;
  
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        "Gemini receipt extraction returned invalid JSON"
      );
    }
  
    if (
      typeof parsed !== "object" ||
      parsed === null
    ) {
      throw new Error(
        "Gemini receipt extraction returned invalid data"
      );
    }
  
    const value =
      parsed as Record<string, unknown>;
  
    const confidence =
      typeof value.confidence === "number"
        ? value.confidence
        : 0;
  
    return {
      provider:
        typeof value.provider === "string"
          ? value.provider.trim()
          : null,
  
      transactionReference:
        typeof value.transactionReference ===
          "string"
          ? value.transactionReference.trim()
          : null,
  
      amount:
        typeof value.amount === "number" &&
        Number.isFinite(value.amount)
          ? value.amount
          : null,
  
      currency:
        typeof value.currency === "string"
          ? value.currency.trim().toUpperCase()
          : null,
  
      transactionDate:
        typeof value.transactionDate ===
          "string"
          ? value.transactionDate.trim()
          : null,
  
      transactionTime:
        typeof value.transactionTime ===
          "string"
          ? value.transactionTime.trim()
          : null,
  
      senderName:
        typeof value.senderName === "string"
          ? value.senderName.trim()
          : null,
  
      senderAccount:
        typeof value.senderAccount ===
          "string"
          ? value.senderAccount.trim()
          : null,
  
      confidence: Math.min(
        1,
        Math.max(0, confidence)
      )
    };
  }