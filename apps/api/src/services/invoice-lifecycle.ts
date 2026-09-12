import {
  MerchantInvoiceStatus,
  prisma
} from "@ethio-commerce/database";

export type OpenMerchantInvoiceInput = {
  merchantId: string;
  invoiceId: string;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
};

export async function openMerchantInvoice(
  input: OpenMerchantInvoiceInput
) {
  const {
    merchantId,
    invoiceId,
    actorUserId = null,
    actorPlatformUserId = null
  } = input;

  if (!merchantId.trim()) {
    throw new Error(
      "Merchant ID is required"
    );
  }

  if (!invoiceId.trim()) {
    throw new Error(
      "Invoice ID is required"
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const invoice =
        await tx.merchantInvoice.findUnique({
          where: {
            id_merchantId: {
              id: invoiceId,
              merchantId
            }
          }
        });

      if (!invoice) {
        throw new Error(
          "Merchant invoice not found"
        );
      }

      if (
        invoice.status !==
        MerchantInvoiceStatus.DRAFT
      ) {
        throw new Error(
          "Only draft invoices can be opened"
        );
      }

      const openedAt =
        new Date();

      /*
       * The status in the WHERE clause is the
       * concurrency claim.
       *
       * Two actors may read the same DRAFT invoice,
       * but only one may successfully transition it
       * to OPEN.
       */
      const claim =
        await tx.merchantInvoice.updateMany({
          where: {
            id: invoice.id,
            merchantId,
            status:
              MerchantInvoiceStatus.DRAFT
          },
          data: {
            status:
              MerchantInvoiceStatus.OPEN,
            openedAt
          }
        });

      if (claim.count !== 1) {
        throw new Error(
          "Invoice status changed concurrently"
        );
      }

      const openedInvoice =
        await tx.merchantInvoice.findUnique({
          where: {
            id_merchantId: {
              id: invoice.id,
              merchantId
            }
          }
        });

      if (!openedInvoice) {
        throw new Error(
          "Merchant invoice not found after opening"
        );
      }

      await tx.auditLog.create({
        data: {
          merchantId,
          actorUserId,
          action:
            "INVOICE_OPENED",
          entityType:
            "MERCHANT_INVOICE",
          entityId:
            openedInvoice.id,
          metadata: {
            previousStatus:
              MerchantInvoiceStatus.DRAFT,
            nextStatus:
              openedInvoice.status,
            openedAt:
              openedInvoice.openedAt
                ?.toISOString() ??
              null
          }
        }
      });

      if (actorPlatformUserId) {
        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId,
            merchantId,
            action:
              "MERCHANT_INVOICE_OPENED",
            entityType:
              "MERCHANT_INVOICE",
            entityId:
              openedInvoice.id,
            metadata: {
              previousStatus:
                MerchantInvoiceStatus.DRAFT,
              nextStatus:
                openedInvoice.status,
              openedAt:
                openedInvoice.openedAt
                  ?.toISOString() ??
                null
            }
          }
        });
      }

      return openedInvoice;
    }
  );
}
