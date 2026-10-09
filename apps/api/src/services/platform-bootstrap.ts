
import {
    prisma
  } from "@ethio-commerce/database";

  import {
    hashPassword
  } from "./auth.js";

  export async function bootstrapPlatformOwner(
    input: {
      email: string;
      displayName?: string | null;
      password: string;
    }
  ) {
    const email =
      input.email.trim().toLowerCase();

    if (!email) {
      throw new Error(
        "Email is required."
      );
    }

    if (
      typeof input.password !== "string" ||
      input.password.length < 8
    ) {
      throw new Error(
        "Password must contain at least 8 characters."
      );
    }

    const passwordHash =
        await hashPassword(
            input.password
        );

    return prisma.$transaction(
        async (tx) => {
            await tx.$executeRaw`
                SELECT pg_advisory_xact_lock(
                    1505,
                    1
                )
          ` ;

        const existingUser =
          await tx.platformUser.findFirst({
            select: {
              id: true
            }
          });

        if (existingUser) {
          throw new Error(
            "Platform bootstrap is disabled because a platform user already exists."
          );
        }

        return tx.platformUser.create({
          data: {
            email,
            passwordHash,
            displayName:
              input.displayName?.trim() || null,
            role: "OWNER"
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true
          }
        });
      }
    );
  }
