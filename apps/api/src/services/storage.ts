import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import { env } from "../config/env.js";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

type AllowedImageType =
  (typeof ALLOWED_IMAGE_TYPES)[number];

function getR2Client(): S3Client {
  if (
    !env.r2AccountId ||
    !env.r2AccessKeyId ||
    !env.r2SecretAccessKey
  ) {
    throw new Error(
      "R2 storage is not configured"
    );
  }

  return new S3Client({
    region: "auto",
    endpoint:
      `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:
        env.r2AccessKeyId,
      secretAccessKey:
        env.r2SecretAccessKey
    }
  });
}

export function isAllowedImageType(
  value: string
): value is AllowedImageType {
  return (
    ALLOWED_IMAGE_TYPES as readonly string[]
  ).includes(value);
}

export function getMaxImageSizeBytes(): number {
  return MAX_IMAGE_SIZE_BYTES;
}

export async function uploadProductImage(
  objectKey: string,
  buffer: Buffer,
  contentType: AllowedImageType
): Promise<string> {
  if (!env.r2Configured) {
    throw new Error(
      "R2 storage is not configured"
    );
  }

  if (
    buffer.length <= 0 ||
    buffer.length > MAX_IMAGE_SIZE_BYTES
  ) {
    throw new Error(
      "Image exceeds the maximum allowed size"
    );
  }

  const client = getR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: env.r2BucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType
    })
  );

  return buildPublicImageUrl(objectKey);
}

export async function uploadReceiptImage(
  objectKey: string,
  buffer: Buffer,
  contentType: AllowedImageType
): Promise<string> {
  if (!env.r2Configured) {
    throw new Error("R2 storage is not configured");
  }

  if (
    buffer.length <= 0 ||
    buffer.length > MAX_IMAGE_SIZE_BYTES
  ) {
    throw new Error(
      "Receipt image exceeds the maximum allowed size"
    );
  }

  if (!isAllowedImageType(contentType)) {
    throw new Error(
      "Unsupported receipt image type"
    );
  }

  const client = getR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: env.r2BucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType
    })
  );

  return buildPublicImageUrl(objectKey);
}

export async function deleteStoredImage(
  objectKey: string
): Promise<void> {
  if (!env.r2Configured) {
    throw new Error(
      "R2 storage is not configured"
    );
  }

  const client = getR2Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: env.r2BucketName,
      Key: objectKey
    })
  );
}

function buildPublicImageUrl(
  objectKey: string
): string {
  if (!env.r2PublicBaseUrl) {
    throw new Error(
      "R2 public base URL is not configured"
    );
  }

  return `${env.r2PublicBaseUrl.replace(/\/$/, "")}/${objectKey}`;
}

export async function uploadSettlementReceipt(
  objectKey: string,
  buffer: Buffer,
  contentType: AllowedImageType
): Promise<void> {
  if (!env.r2SettlementConfigured) {
    throw new Error(
      "Settlement receipt storage is not configured"
    );
  }

  if (
    buffer.length <= 0 ||
    buffer.length > MAX_IMAGE_SIZE_BYTES
  ) {
    throw new Error(
      "Receipt image exceeds the maximum allowed size"
    );
  }

  if (!isAllowedImageType(contentType)) {
    throw new Error(
      "Unsupported receipt image type"
    );
  }

  const client = getR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket:
        env.r2SettlementBucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType
    })
  );
}

export async function deleteSettlementReceipt(
  objectKey: string
): Promise<void> {
  if (!env.r2SettlementConfigured) {
    throw new Error(
      "Settlement receipt storage is not configured"
    );
  }

  const client = getR2Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket:
        env.r2SettlementBucketName,
      Key: objectKey
    })
  );
}

export type SettlementReceiptObject = {
  buffer: Buffer;
  contentType: string | null;
  contentLength: number;
};

export async function getSettlementReceipt(
  objectKey: string
): Promise<SettlementReceiptObject> {
  if (!env.r2SettlementConfigured) {
    throw new Error(
      "Settlement receipt storage is not configured"
    );
  }

  const normalizedObjectKey =
    objectKey.trim();

  if (!normalizedObjectKey) {
    throw new Error(
      "Settlement receipt object key is required"
    );
  }

  const client = getR2Client();

  const response =
    await client.send(
      new GetObjectCommand({
        Bucket:
          env.r2SettlementBucketName,
        Key:
          normalizedObjectKey
      })
    );

  if (!response.Body) {
    throw new Error(
      "Settlement receipt object has no body"
    );
  }

  const bytes =
    await response.Body.transformToByteArray();

  const buffer =
    Buffer.from(bytes);

  if (
    buffer.length <= 0 ||
    buffer.length >
    MAX_IMAGE_SIZE_BYTES
  ) {
    throw new Error(
      "Settlement receipt object has an invalid size"
    );
  }

  return {
    buffer,
    contentType:
      response.ContentType ??
      null,
    contentLength:
      buffer.length
  };
}