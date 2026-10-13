import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env"),
  override: false,
});

if (!process.env.MERCHANT_INVITATION_ENCRYPTION_KEY) {
  process.env.MERCHANT_INVITATION_ENCRYPTION_KEY =
    "test-only-merchant-invitation-encryption-key-2026";
}

if (!process.env.PUBLIC_API_BASE_URL) {
  process.env.PUBLIC_API_BASE_URL =
    "http://127.0.0.1:3000";
}