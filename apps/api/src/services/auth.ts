import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";

import { prisma } from "@ethio-commerce/database";

import { env } from "../config/env.js";

const PASSWORD_KEY_LENGTH = 64;

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

const TOKEN_VERSION = "v1";

type AuthTokenPayload = {
  userId: string;
  merchantId: string;
  role: string;
  issuedAt: number;
  expiresAt: number;
};

export type AuthenticatedUser = {
  id: string;
  merchantId: string;
  email: string;
  displayName: string | null;
  role: string;
};

function base64UrlEncode(
  value: string | Buffer
): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(
  value: string
): Buffer {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padding =
    normalized.length % 4 === 0
      ? ""
      : "=".repeat(4 - (normalized.length % 4));

  return Buffer.from(
    normalized + padding,
    "base64"
  );
}

function normalizeEmail(
  email: string
): string {
  return email.trim().toLowerCase();
}

function signToken(
  payload: string
): string {
  return createHmac(
    "sha256",
    env.authSecret
  )
    .update(payload)
    .digest("base64url");
}

async function deriveKey(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number
): Promise<Buffer> {
  return new Promise(
    (resolve, reject) => {
      scryptCallback(
        password,
        salt,
        PASSWORD_KEY_LENGTH,
        {
          N: cost,
          r: blockSize,
          p: parallelization
        },
        (
          error,
          derivedKey
        ) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(
            derivedKey as Buffer
          );
        }
      );
    }
  );
}

export async function hashPassword(
  password: string
): Promise<string> {
  if (
    typeof password !== "string" ||
    password.length < 8
  ) {
    throw new Error(
      "Password must contain at least 8 characters."
    );
  }

  const salt = randomBytes(16);

  const derivedKey =
    await deriveKey(
      password,
      salt,
      SCRYPT_COST,
      SCRYPT_BLOCK_SIZE,
      SCRYPT_PARALLELIZATION
    );

  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url")
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const parts =
      storedHash.split("$");

    if (
      parts.length !== 6 ||
      parts[0] !== "scrypt"
    ) {
      return false;
    }

    const cost = Number(parts[1]);
    const blockSize = Number(parts[2]);
    const parallelization =
      Number(parts[3]);

    const salt = Buffer.from(
      parts[4],
      "base64url"
    );

    const expected = Buffer.from(
      parts[5],
      "base64url"
    );

    if (
      !Number.isInteger(cost) ||
      !Number.isInteger(blockSize) ||
      !Number.isInteger(
        parallelization
      ) ||
      cost <= 1 ||
      blockSize <= 0 ||
      parallelization <= 0 ||
      expected.length !==
        PASSWORD_KEY_LENGTH ||
      salt.length === 0
    ) {
      return false;
    }

    const derived =
      await deriveKey(
        password,
        salt,
        cost,
        blockSize,
        parallelization
      );

    if (
      derived.length !==
      expected.length
    ) {
      return false;
    }

    return timingSafeEqual(
      expected,
      derived
    );
  } catch {
    return false;
  }
}

export function createAuthToken(
  user: {
    id: string;
    merchantId: string;
    role: string;
  }
): string {
  const issuedAt =
    Math.floor(Date.now() / 1000);

  const expiresAt =
    issuedAt +
    env.authTokenTtlSeconds;

  const payload: AuthTokenPayload = {
    userId: user.id,
    merchantId: user.merchantId,
    role: user.role,
    issuedAt,
    expiresAt
  };

  const encodedPayload =
    base64UrlEncode(
      JSON.stringify(payload)
    );

  const unsignedToken =
    `${TOKEN_VERSION}.${encodedPayload}`;

  const signature =
    signToken(unsignedToken);

  return `${unsignedToken}.${signature}`;
}

export function verifyAuthToken(
  token: string
): AuthTokenPayload | null {
  try {
    const parts =
      token.split(".");

    if (
      parts.length !== 3 ||
      parts[0] !== TOKEN_VERSION
    ) {
      return null;
    }

    const unsignedToken =
      `${parts[0]}.${parts[1]}`;

    const expectedSignature =
      signToken(unsignedToken);

    const suppliedSignature =
      parts[2];

    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        "utf8"
      );

    const suppliedBuffer =
      Buffer.from(
        suppliedSignature,
        "utf8"
      );

    if (
      expectedBuffer.length !==
      suppliedBuffer.length
    ) {
      return null;
    }

    if (
      !timingSafeEqual(
        expectedBuffer,
        suppliedBuffer
      )
    ) {
      return null;
    }

    const payload =
      JSON.parse(
        base64UrlDecode(
          parts[1]
        ).toString("utf8")
      ) as AuthTokenPayload;

    if (
      !payload.userId ||
      !payload.merchantId ||
      !payload.role ||
      !Number.isInteger(
        payload.issuedAt
      ) ||
      !Number.isInteger(
        payload.expiresAt
      )
    ) {
      return null;
    }

    const now =
      Math.floor(Date.now() / 1000);

    if (
      payload.expiresAt <= now
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const normalizedEmail =
    normalizeEmail(email);

  if (
    !normalizedEmail ||
    !password
  ) {
    return null;
  }

  const user =
    await prisma.merchantUser.findUnique({
      where: {
        email: normalizedEmail
      },
      select: {
        id: true,
        merchantId: true,
        email: true,
        passwordHash: true,
        displayName: true,
        role: true
      }
    });

  if (!user) {
    return null;
  }

  const passwordValid =
    await verifyPassword(
      password,
      user.passwordHash
    );

  if (!passwordValid) {
    return null;
  }

  return {
    id: user.id,
    merchantId: user.merchantId,
    email: user.email,
    displayName:
      user.displayName,
    role: user.role
  };
}