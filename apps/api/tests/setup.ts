import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env"),
  override: true,
});

if (!process.env.PUBLIC_API_BASE_URL) {
  process.env.PUBLIC_API_BASE_URL =
    "http://127.0.0.1:3000";
}