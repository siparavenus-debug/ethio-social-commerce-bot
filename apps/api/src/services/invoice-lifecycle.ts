import {
  MerchantInvoiceReminderType,
  MerchantInvoiceStatus,
  MerchantSettlementStatus,
  MerchantSubscriptionStatus,
  Prisma,
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

      const dueAt =
        new Date(
          openedAt.getTime() +
            7 * 24 * 60 * 60 * 1000
        );

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
            openedAt,
            dueAt
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

export type MarkMerchantInvoiceOverdueInput = {
  merchantId: string;
  invoiceId: string;
  now?: Date;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
};

const MAX_OVERDUE_SERIALIZABLE_ATTEMPTS = 3;

async function markMerchantInvoiceOverdueAttempt(
  input: MarkMerchantInvoiceOverdueInput
) {
  const {
    merchantId,
    invoiceId,
    now = new Date(),
    actorUserId = null,
    actorPlatformUserId = null
  } = input;

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
        MerchantInvoiceStatus.OPEN
      ) {
        throw new Error(
          "Only open invoices can be marked overdue"
        );
      }

      if (!invoice.dueAt) {
        throw new Error(
          "Open invoice has no due date"
        );
      }

      if (
        invoice.dueAt.getTime() >=
        now.getTime()
      ) {
        throw new Error(
          "Invoice due date has not passed"
        );
      }

      const pendingSettlement =
        await tx.merchantSettlement.findFirst({
          where: {
            merchantId,
            invoiceId:
              invoice.id,
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED
          },
          select: {
            id: true
          }
        });

      if (pendingSettlement) {
        throw new Error(
          "Invoice has a settlement awaiting review"
        );
      }

      const claim =
        await tx.merchantInvoice.updateMany({
          where: {
            id: invoice.id,
            merchantId,
            status:
              MerchantInvoiceStatus.OPEN,
            dueAt: {
              lt: now
            }
          },
          data: {
            status:
              MerchantInvoiceStatus.OVERDUE
          }
        });

      if (claim.count !== 1) {
        throw new Error(
          "Invoice status changed concurrently"
        );
      }

      await tx.merchantInvoiceReminder.create({
        data: {
          merchantId,
          invoiceId:
            invoice.id,
          type:
            MerchantInvoiceReminderType.FIRST_OVERDUE
        }
      });

      const subscriptionTransition =
        await tx.merchantSubscription.updateMany({
          where: {
            merchantId,
            status:
              MerchantSubscriptionStatus.ACTIVE
          },
          data: {
            status:
              MerchantSubscriptionStatus.PAST_DUE
          }
        });

      if (subscriptionTransition.count === 1) {
        const subscription =
          await tx.merchantSubscription.findUnique({
            where: {
              merchantId
            }
          });

        if (!subscription) {
          throw new Error(
            "Merchant subscription not found after status transition"
          );
        }

        await tx.auditLog.create({
          data: {
            merchantId,
            actorUserId,
            action:
              "SUBSCRIPTION_STATUS_CHANGED",
            entityType:
              "MERCHANT_SUBSCRIPTION",
            entityId:
              subscription.id,
            metadata: {
              previousStatus:
                MerchantSubscriptionStatus.ACTIVE,
              nextStatus:
                MerchantSubscriptionStatus.PAST_DUE
            }
          }
        });

        if (actorPlatformUserId) {
          await tx.platformAuditLog.create({
            data: {
              actorPlatformUserId,
              merchantId,
              action:
                "MERCHANT_SUBSCRIPTION_STATUS_CHANGED",
              entityType:
                "MERCHANT_SUBSCRIPTION",
              entityId:
                subscription.id,
              metadata: {
                previousStatus:
                  MerchantSubscriptionStatus.ACTIVE,
                nextStatus:
                  MerchantSubscriptionStatus.PAST_DUE
              }
            }
          });
        }
      }

      const overdueInvoice =
        await tx.merchantInvoice.findUnique({
          where: {
            id_merchantId: {
              id: invoice.id,
              merchantId
            }
          }
        });

      if (!overdueInvoice) {
        throw new Error(
          "Merchant invoice not found after overdue transition"
        );
      }

      await tx.auditLog.create({
        data: {
          merchantId,
          actorUserId,
          action:
            "INVOICE_MARKED_OVERDUE",
          entityType:
            "MERCHANT_INVOICE",
          entityId:
            overdueInvoice.id,
          metadata: {
            previousStatus:
              MerchantInvoiceStatus.OPEN,
            nextStatus:
              overdueInvoice.status,
            dueAt:
              overdueInvoice.dueAt
                ?.toISOString() ?? null,
            evaluatedAt:
              now.toISOString()
          }
        }
      });

      if (actorPlatformUserId) {
        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId,
            merchantId,
            action:
              "MERCHANT_INVOICE_MARKED_OVERDUE",
            entityType:
              "MERCHANT_INVOICE",
            entityId:
              overdueInvoice.id,
            metadata: {
              previousStatus:
                MerchantInvoiceStatus.OPEN,
              nextStatus:
                overdueInvoice.status,
              dueAt:
                overdueInvoice.dueAt
                  ?.toISOString() ?? null,
              evaluatedAt:
                now.toISOString()
            }
          }
        });
      }

      return overdueInvoice;
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable
    }
  );
}

export async function markMerchantInvoiceOverdue(
  input: MarkMerchantInvoiceOverdueInput
) {
  if (!input.merchantId.trim()) {
    throw new Error("Merchant ID is required");
  }

  if (!input.invoiceId.trim()) {
    throw new Error("Invoice ID is required");
  }

  for (
    let attempt = 1;
    attempt <=
      MAX_OVERDUE_SERIALIZABLE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await markMerchantInvoiceOverdueAttempt(
        input
      );
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt <
          MAX_OVERDUE_SERIALIZABLE_ATTEMPTS
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Merchant invoice overdue transition could not be completed"
  );
}

export type ProcessOverdueMerchantInvoicesInput = {
  now?: Date;
};

export async function processOverdueMerchantInvoices(
  input: ProcessOverdueMerchantInvoicesInput = {}
) {
  const now =
    input.now ?? new Date();

  const candidates =
    await prisma.merchantInvoice.findMany({
      where: {
        status:
          MerchantInvoiceStatus.OPEN,
        dueAt: {
          lt: now
        }
      },
      select: {
        id: true,
        merchantId: true
      },
      orderBy: {
        dueAt: "asc"
      }
    });

  const results =
    await Promise.allSettled(
      candidates.map(
        (invoice) =>
          markMerchantInvoiceOverdue({
            merchantId:
              invoice.merchantId,
            invoiceId:
              invoice.id,
            now
          })
      )
    );

  return {
    discoveredCount:
      candidates.length,
    markedOverdueCount:
      results.filter(
        (result) =>
          result.status === "fulfilled"
      ).length,
    skippedCount:
      results.filter(
        (result) =>
          result.status === "rejected"
      ).length
  };
}

export type ProcessSecondOverdueInvoiceRemindersInput = {
  now?: Date;
};

export async function processSecondOverdueInvoiceReminders(
  input: ProcessSecondOverdueInvoiceRemindersInput = {}
) {
  const now =
    input.now ?? new Date();

  const secondReminderDueAt =
    new Date(
      now.getTime() -
        3 * 24 * 60 * 60 * 1000
    );

  const candidates =
    await prisma.merchantInvoice.findMany({
      where: {
        status:
          MerchantInvoiceStatus.OVERDUE,
        dueAt: {
          lte:
            secondReminderDueAt
        },
        settlements: {
          none: {
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED
          }
        },
        reminders: {
          none: {
            type:
              MerchantInvoiceReminderType
                .SECOND_OVERDUE
          }
        }
      },
      select: {
        id: true,
        merchantId: true
      },
      orderBy: {
        dueAt: "asc"
      }
    });

  const results =
    await Promise.allSettled(
      candidates.map(
        (invoice) =>
          prisma.merchantInvoiceReminder.create({
            data: {
              merchantId:
                invoice.merchantId,
              invoiceId:
                invoice.id,
              type:
                MerchantInvoiceReminderType
                  .SECOND_OVERDUE
            }
          })
      )
    );

  return {
    discoveredCount:
      candidates.length,
    createdCount:
      results.filter(
        (result) =>
          result.status === "fulfilled"
      ).length,
    skippedCount:
      results.filter(
        (result) =>
          result.status === "rejected"
      ).length
  };
}

export type ProcessPastDueSubscriptionSuspensionsInput = {
  now?: Date;
};

async function suspendPastDueSubscriptionAttempt(
  merchantId: string,
  invoiceId: string,
  now: Date
) {
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
        MerchantInvoiceStatus.OVERDUE
      ) {
        throw new Error(
          "Only overdue invoices can trigger subscription suspension"
        );
      }

      if (!invoice.dueAt) {
        throw new Error(
          "Overdue invoice has no due date"
        );
      }

      const suspensionDueAt =
        new Date(
          invoice.dueAt.getTime() +
            7 * 24 * 60 * 60 * 1000
        );

      if (
        now.getTime() <
        suspensionDueAt.getTime()
      ) {
        throw new Error(
          "Invoice grace period has not ended"
        );
      }

      const pendingSettlement =
        await tx.merchantSettlement.findFirst({
          where: {
            merchantId,
            invoiceId:
              invoice.id,
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED
          },
          select: {
            id: true
          }
        });

      if (pendingSettlement) {
        throw new Error(
          "Invoice has a settlement awaiting review"
        );
      }

      const subscriptionTransition =
        await tx.merchantSubscription.updateMany({
          where: {
            merchantId,
            status:
              MerchantSubscriptionStatus.PAST_DUE
          },
          data: {
            status:
              MerchantSubscriptionStatus.SUSPENDED
          }
        });

      if (subscriptionTransition.count !== 1) {
        throw new Error(
          "Merchant subscription is not past due"
        );
      }

      const subscription =
        await tx.merchantSubscription.findUnique({
          where: {
            merchantId
          }
        });

      if (!subscription) {
        throw new Error(
          "Merchant subscription not found after status transition"
        );
      }

      await tx.auditLog.create({
        data: {
          merchantId,
          actorUserId: null,
          action:
            "SUBSCRIPTION_STATUS_CHANGED",
          entityType:
            "MERCHANT_SUBSCRIPTION",
          entityId:
            subscription.id,
          metadata: {
            previousStatus:
              MerchantSubscriptionStatus.PAST_DUE,
            nextStatus:
              MerchantSubscriptionStatus.SUSPENDED
          }
        }
      });

      return subscription;
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable
    }
  );
}

async function suspendPastDueSubscription(
  merchantId: string,
  invoiceId: string,
  now: Date
) {
  for (
    let attempt = 1;
    attempt <=
      MAX_OVERDUE_SERIALIZABLE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await suspendPastDueSubscriptionAttempt(
        merchantId,
        invoiceId,
        now
      );
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt <
          MAX_OVERDUE_SERIALIZABLE_ATTEMPTS
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Merchant subscription suspension could not be completed"
  );
}

export async function processPastDueSubscriptionSuspensions(
  input: ProcessPastDueSubscriptionSuspensionsInput = {}
) {
  const now =
    input.now ?? new Date();

  const suspensionDueAt =
    new Date(
      now.getTime() -
        7 * 24 * 60 * 60 * 1000
    );

  const candidates =
    await prisma.merchantInvoice.findMany({
      where: {
        status:
          MerchantInvoiceStatus.OVERDUE,
        dueAt: {
          lte:
            suspensionDueAt
        },
        settlements: {
          none: {
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED
          }
        },
        merchant: {
          subscription: {
            status:
              MerchantSubscriptionStatus.PAST_DUE
          }
        }
      },
      select: {
        id: true,
        merchantId: true
      },
      orderBy: {
        dueAt: "asc"
      }
    });

  const candidatesByMerchant =
    candidates.filter(
      (invoice, index) =>
        candidates.findIndex(
          (candidate) =>
            candidate.merchantId ===
            invoice.merchantId
        ) === index
    );

  const results =
    await Promise.allSettled(
      candidatesByMerchant.map(
        (invoice) =>
          suspendPastDueSubscription(
            invoice.merchantId,
            invoice.id,
            now
          )
      )
    );

  return {
    discoveredCount:
      candidatesByMerchant.length,
    suspendedCount:
      results.filter(
        (result) =>
          result.status === "fulfilled"
      ).length,
    skippedCount:
      results.filter(
        (result) =>
          result.status === "rejected"
      ).length
  };
}
