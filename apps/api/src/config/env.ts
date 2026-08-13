import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env")
});

const port = Number(process.env.API_PORT ?? "3000");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("API_PORT must be a valid TCP port.");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  apiPort: port
} as const;