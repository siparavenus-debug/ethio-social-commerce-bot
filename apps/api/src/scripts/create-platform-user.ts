import readline from "node:readline";

import {
  prisma
} from "@ethio-commerce/database";

import {
  hashPassword
} from "../services/auth.js";

function ask(
  question: string,
  trim = true
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
            trim
              ? answer.trim()
              : answer
          );
        }
      );
    }
  );
}

async function main() {
  console.log("");
  console.log(
    "Ethio Social Commerce - Create Platform User"
  );
  console.log(
    "-------------------------------------------"
  );
  console.log("");

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
      "Password: ",
      false
    );

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

  const normalizedEmail =
    email.trim().toLowerCase();

  const existingUser =
    await prisma.platformUser.findUnique({
      where: {
        email: normalizedEmail
      },
      select: {
        id: true
      }
    });

  if (existingUser) {
    throw new Error(
      `A platform user with ${normalizedEmail} already exists.`
    );
  }

  const passwordHash =
    await hashPassword(
      password
    );

  const user =
    await prisma.platformUser.create({
      data: {
        email:
          normalizedEmail,

        passwordHash,

        displayName:
          displayName || null
      },
      select: {
        id: true,
        email: true,
        displayName: true
      }
    });

  console.log("");
  console.log(
    "Platform user created successfully."
  );
  console.log("");
  console.log(
    `Platform User ID: ${user.id}`
  );
  console.log(
    `Email: ${user.email}`
  );
  console.log(
    `Display name: ${user.displayName ?? "(none)"}`
  );
  console.log("");
}

main()
  .catch((error) => {
    console.error("");
    console.error(
      "Failed to create platform user:"
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