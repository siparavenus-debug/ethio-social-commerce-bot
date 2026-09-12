import {
    createHmac,
    timingSafeEqual
  } from "node:crypto";

  import { prisma } from "@ethio-commerce/database";

  import { env } from "../config/env.js";
  import { verifyPassword } from "./auth.js";

  const PLATFORM_TOKEN_VERSION = "platform-v1";

  type PlatformAuthTokenPayload = {
    platformUserId: string;
    tokenVersion: number;
    issuedAt: number;
    expiresAt: number;
  };

  export type AuthenticatedPlatformUser = {
    id: string;
    email: string;
    displayName: string | null;
    tokenVersion: number;
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
        : "=".repeat(
            4 - (normalized.length % 4)
          );

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

  function signPlatformToken(
    payload: string
  ): string {
    return createHmac(
      "sha256",
      env.platformAuthSecret
    )
      .update(payload)
      .digest("base64url");
  }

  export function createPlatformAuthToken(
    user: {
      id: string;
      tokenVersion: number;
    }
  ): string {
    const issuedAt =
      Math.floor(Date.now() / 1000);

    const expiresAt =
      issuedAt +
      env.authTokenTtlSeconds;

    const payload: PlatformAuthTokenPayload = {
      platformUserId: user.id,
      tokenVersion: user.tokenVersion,
      issuedAt,
      expiresAt
    };

    const encodedPayload =
      base64UrlEncode(
        JSON.stringify(payload)
      );

    const unsignedToken =
      `${PLATFORM_TOKEN_VERSION}.${encodedPayload}`;

    const signature =
      signPlatformToken(unsignedToken);

    return `${unsignedToken}.${signature}`;
  }

  export function verifyPlatformAuthToken(
    token: string
  ): PlatformAuthTokenPayload | null {
    try {
      const parts = token.split(".");

      if (
        parts.length !== 3 ||
        parts[0] !== PLATFORM_TOKEN_VERSION
      ) {
        return null;
      }

      const unsignedToken =
        `${parts[0]}.${parts[1]}`;

      const expectedSignature =
        signPlatformToken(unsignedToken);

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
        ) as PlatformAuthTokenPayload;

      if (
        !payload.platformUserId ||
        !Number.isInteger(
          payload.tokenVersion
        ) ||
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

  export async function authenticatePlatformUser(
    email: string,
    password: string
  ): Promise<AuthenticatedPlatformUser | null> {
    const normalizedEmail =
      normalizeEmail(email);

    if (
      !normalizedEmail ||
      !password
    ) {
      return null;
    }

    const user =
      await prisma.platformUser.findUnique({
        where: {
          email: normalizedEmail
        },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          displayName: true,
          tokenVersion: true
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
      email: user.email,
      displayName: user.displayName,
      tokenVersion: user.tokenVersion
    };
  }
