import { describe, expect, it } from "vitest";
import {
  commerceToolNames,
  isCommerceToolName
} from "../src/tools/tool-definitions.js";

describe("commerce tool definitions", () => {
  it("defines all required commerce tools", () => {
    expect([...commerceToolNames].sort()).toEqual([
      "checkStock",
      "createOrder",
      "getOrderStatus",
      "getPaymentInstructions",
      "getProduct",
      "searchProducts"
    ]);
  });

  it("recognizes registered tools", () => {
    expect(isCommerceToolName("searchProducts")).toBe(true);
    expect(isCommerceToolName("getProduct")).toBe(true);
    expect(isCommerceToolName("checkStock")).toBe(true);
    expect(isCommerceToolName("createOrder")).toBe(true);
    expect(isCommerceToolName("getOrderStatus")).toBe(true);
    expect(
      isCommerceToolName("getPaymentInstructions")
    ).toBe(true);
  });

  it("rejects unknown tools", () => {
    expect(isCommerceToolName("deleteDatabase")).toBe(false);
    expect(isCommerceToolName("approvePayment")).toBe(false);
    expect(isCommerceToolName("unknownTool")).toBe(false);
  });
});
