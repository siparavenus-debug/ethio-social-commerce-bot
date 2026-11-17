
import {
    Prisma,
    prisma
  } from "@ethio-commerce/database";

  import {
    lockPlatformBillingMerchant
  } from "./platform-billing-merchant-lock.js";

  import {
    validatePlatformBillingRequestStart
  } from "./platform-billing-notification-pre-send.js";

  export type BillingTransportContextResult =
    | {
        resolved: true;
        sendAuthorized: false;
        deliveryId: string;
        attemptId: string;
        destinationId: string;
        platformBotId: string;
        botIdentityId: string;
        chatId: string;
      }
    | {
        resolved: false;
        sendAuthorized: false;
        reason: string;
      };

  function reject(
    reason: string
  ): BillingTransportContextResult {
    return {
      resolved: false,
      sendAuthorized: false,
      reason
    };
  }

  export async function resolvePlatformBillingTransportContext(
    deliveryId: string,
    claimId: string,
    attemptId: string
  ): Promise<BillingTransportContextResult> {
    if (
      !deliveryId?.trim() ||
      !claimId?.trim() ||
      !attemptId?.trim()
    ) {
      return reject("INVALID_TRANSPORT_INPUT");
    }

    return prisma.$transaction(
      async (tx): Promise<BillingTransportContextResult> => {
        const initial =
          await tx.platformBillingNotificationDelivery.findUnique({
            where: { id: deliveryId },
            select: { merchantId: true }
          });

        if (!initial) {
          return reject("DELIVERY_NOT_FOUND");
        }

        await lockPlatformBillingMerchant(
          tx,
          initial.merchantId
        );

        const delivery =
          await tx.platformBillingNotificationDelivery.findUnique({
            where: { id: deliveryId },
            select: {
              merchantId: true,
              status: true,
              claimId: true,
              processingUntil: true,
              attemptCount: true,
              destinationId: true,
              destinationLinkVersion: true,
              notification: {
                select: { status: true }
              },
              destination: {
                select: {
                  id: true,
                  linkVersion: true,
                  chatId: true,
                  platformBotId: true,
                  platformBot: {
                    select: {
                      id: true,
                      botIdentityId: true
                    }
                  }
                }
              },
              attempts: {
                select: {
                  id: true,
                  claimId: true,
                  attemptNumber: true,
                  outcome: true,
                  requestStartedAt: true
                }
              }
            }
          });

        if (
          !delivery ||
          delivery.merchantId !== initial.merchantId
        ) {
          return reject("DELIVERY_CHANGED");
        }

        if (
          delivery.status !== "SENDING" ||
          delivery.claimId !== claimId ||
          delivery.notification.status !== "PENDING"
        ) {
          return reject("DELIVERY_NOT_SENDABLE");
        }

        if (
          !delivery.processingUntil ||
          delivery.processingUntil <= new Date()
        ) {
          return reject("CLAIM_LEASE_EXPIRED");
        }

        const attempt = delivery.attempts.find(
          (item) => item.id === attemptId
        );

        if (
          !attempt ||
          attempt.claimId !== claimId ||
          attempt.attemptNumber !== delivery.attemptCount ||
          attempt.outcome !== "PREPARED" ||
          attempt.requestStartedAt !== null
        ) {
          return reject("ATTEMPT_NOT_PREPARED");
        }

        if (
          delivery.attempts.some(
            (item) =>
              item.id !== attemptId &&
              (
                item.outcome !== "FAILED_PRE_SEND" ||
                item.requestStartedAt !== null
              )
          )
        ) {
          return reject("CONFLICTING_ATTEMPT");
        }

        const eligibility =
          await validatePlatformBillingRequestStart(
            tx,
            deliveryId
          );

        if (!eligibility.eligible) {
          return reject(
            `TRANSPORT_${eligibility.disposition}_${eligibility.reason}`
          );
        }

        const destination = delivery.destination;

        if (
          !destination ||
          destination.id !== delivery.destinationId ||
          destination.linkVersion !==
            delivery.destinationLinkVersion ||
          destination.platformBot.id !==
            destination.platformBotId
        ) {
          return reject("DESTINATION_CHANGED");
        }

        return {
          resolved: true,
          sendAuthorized: false,
          deliveryId,
          attemptId,
          destinationId: destination.id,
          platformBotId: destination.platformBotId,
          botIdentityId:
            destination.platformBot.botIdentityId,
          chatId: destination.chatId
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.ReadCommitted
      }
    );
  }
