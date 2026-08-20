import readline from "node:readline";

import {
  prisma
} from "@ethio-commerce/database";

import {
  hashPassword
} from "../services/auth.js";

function ask(
  question: string
): Promise<string> {
  const rl =
    readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

  return new Promise(
    (resolve) => {
      rl.question(
        question,
        (answer) => {
          rl.close();
          resolve(
            answer.trim()
          );
        }
      );
    }
  );
}

async function main() {
  console.log("");
  console.log(
    "Ethio Social Commerce - Create Merchant User"
  );
  console.log(
    "-------------------------------------------"
  );
  console.log("");

  const merchantId =
    await ask(
      "Merchant ID: "
    );

  const email =
    await ask(
      "Login email: "
    );

  const displayName =
    await ask(
      "Display name: "
    );

  const password =
    await ask(
      "Password: "
    );

  if (!merchantId) {
    throw new Error(
      "Merchant ID is required."
    );
  }

  if (!email) {
    throw new Error(
      "Email is required."
    );
  }

  if (!password) {
    throw new Error(
      "Password is required."
    );
  }

  if (password.length < 8) {
    throw new Error(
      "Password must contain at least 8 characters."
    );
  }

  const merchant =
    await prisma.merchant.findUnique({
      where: {
        id: merchantId
      },
      select: {
        id: true,
        name: true
      }
    });

  if (!merchant) {
    throw new Error(
      `Merchant ${merchantId} was not found.`
    );
  }

  const normalizedEmail =
    email.toLowerCase();

  const existingUser =
    await prisma.merchantUser.findUnique({
      where: {
        email: normalizedEmail
      }
    });

  if (existingUser) {
    throw new Error(
      `A merchant user with ${normalizedEmail} already exists.`
    );
  }

  const passwordHash =
    await hashPassword(
      password
    );

  const user =
    await prisma.merchantUser.create({
      data: {
        merchantId:
          merchant.id,

        email:
          normalizedEmail,

        passwordHash,

        displayName:
          displayName || null,

        role: "OWNER"
      },
      select: {
        id: true,
        merchantId: true,
        email: true,
        displayName: true,
        role: true
      }
    });

  console.log("");
  console.log(
    "Merchant user created successfully."
  );
  console.log("");
  console.log(
    `Merchant: ${merchant.name}`
  );
  console.log(
    `Merchant ID: ${user.merchantId}`
  );
  console.log(
    `Email: ${user.email}`
  );
  console.log(
    `Role: ${user.role}`
  );
  console.log("");
}

main()
  .catch((error) => {
    console.error("");
    console.error(
      "Failed to create merchant user:"
    );
    console.error(
      error instanceof Error
        ? error.message
        : error
    );
    process.exitCode = 1;
  })
  .finally(
    async () => {
      await prisma.$disconnect();
    }
  );