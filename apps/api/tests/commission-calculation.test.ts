import {
    describe,
    expect,
    it
  } from "vitest";

  import {
    Prisma
  } from "@ethio-commerce/database";

  import {
    calculateCommission
  } from "../src/domain/commission-calculation.js";

  describe(
    "commission calculation",
    () => {
      it(
        "calculates an exact commission amount",
        () => {
          const result =
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("100.00"),

              commissionRate:
                new Prisma.Decimal("0.035000")
            });

          expect(
            result.commissionAmount.toFixed(2)
          ).toBe("3.50");
        }
      );

      it(
        "rounds half up to two decimal places",
        () => {
          const result =
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("99.00"),

              commissionRate:
                new Prisma.Decimal("0.035000")
            });

          expect(
            result.commissionAmount.toFixed(2)
          ).toBe("3.47");
        }
      );

      it(
        "rounds a half-cent upward",
        () => {
          const result =
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("1.00"),

              commissionRate:
                new Prisma.Decimal("0.005000")
            });

          expect(
            result.commissionAmount.toFixed(2)
          ).toBe("0.01");
        }
      );

      it(
        "allows a zero commission rate",
        () => {
          const result =
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("100.00"),

              commissionRate:
                new Prisma.Decimal("0")
            });

          expect(
            result.commissionAmount.toFixed(2)
          ).toBe("0.00");
        }
      );

      it(
        "allows a zero transaction amount",
        () => {
          const result =
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("0"),

              commissionRate:
                new Prisma.Decimal("0.035000")
            });

          expect(
            result.commissionAmount.toFixed(2)
          ).toBe("0.00");
        }
      );

      it(
        "calculates commission for a very large transaction amount",
        () => {
          const result =
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("9999999999.99"),
              commissionRate:
                new Prisma.Decimal("0.035000")
            });

          expect(
            result.commissionAmount.toFixed(2)
          ).toBe("350000000.00");
        }
      );

      it(
        "rejects a negative transaction amount",
        () => {
          expect(() =>
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("-1.00"),

              commissionRate:
                new Prisma.Decimal("0.035000")
            })
          ).toThrow(
            "Transaction amount cannot be negative"
          );
        }
      );

      it(
        "rejects a negative commission rate",
        () => {
          expect(() =>
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("100.00"),

              commissionRate:
                new Prisma.Decimal("-0.01")
            })
          ).toThrow(
            "Commission rate must be between 0 and 1"
          );
        }
      );

      it(
        "rejects a commission rate above one",
        () => {
          expect(() =>
            calculateCommission({
              transactionAmount:
                new Prisma.Decimal("100.00"),

              commissionRate:
                new Prisma.Decimal("1.000001")
            })
          ).toThrow(
            "Commission rate must be between 0 and 1"
          );
        }
      );
    }
  );
