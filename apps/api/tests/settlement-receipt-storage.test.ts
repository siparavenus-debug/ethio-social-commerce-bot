import {
    NoSuchKey,
    S3Client
  } from "@aws-sdk/client-s3";
  
  import {
    afterEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";
  
  import {
    getSettlementReceipt,
    SettlementReceiptNotFoundError
  } from "../src/services/storage.js";
  
  describe(
    "settlement receipt private storage",
    () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });
  
      it(
        "translates S3 NoSuchKey into SettlementReceiptNotFoundError",
        async () => {
          const noSuchKey =
            new NoSuchKey({
              message:
                "The specified key does not exist.",
              $metadata: {
                httpStatusCode: 404
              }
            });
  
          const sendSpy =
            vi.spyOn(
              S3Client.prototype,
              "send"
            );
  
          sendSpy.mockRejectedValueOnce(
            noSuchKey
          );
  
          await expect(
            getSettlementReceipt(
              "merchants/test/settlements/missing.webp"
            )
          ).rejects.toBeInstanceOf(
            SettlementReceiptNotFoundError
          );
  
          expect(
            sendSpy
          ).toHaveBeenCalledTimes(1);
        }
      );
  
      it(
        "does not translate unrelated storage failures into missing evidence",
        async () => {
          const storageFailure =
            new Error(
              "Simulated storage infrastructure failure"
            );
  
          const sendSpy =
            vi.spyOn(
              S3Client.prototype,
              "send"
            );
  
          sendSpy.mockRejectedValueOnce(
            storageFailure
          );
  
          await expect(
            getSettlementReceipt(
              "merchants/test/settlements/failure.webp"
            )
          ).rejects.toBe(
            storageFailure
          );
  
          expect(
            sendSpy
          ).toHaveBeenCalledTimes(1);
        }
      );
    }
  );