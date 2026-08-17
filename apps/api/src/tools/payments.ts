import { prisma } from "@ethio-commerce/database";

export type PaymentInstruction = {
  provider: string;
  accountName: string;
  accountNumber: string;
};

export async function getPaymentInstructions(
  merchantId: string
): Promise<PaymentInstruction[]> {
  const paymentMethods = await prisma.paymentMethod.findMany({
    where: {
      merchantId,
      status: "ACTIVE"
    },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      provider: true,
      accountName: true,
      accountNumber: true
    }
  });

  return paymentMethods.map((method) => ({
    provider: method.provider,
    accountName: method.accountName,
    accountNumber: method.accountNumber
  }));
}
