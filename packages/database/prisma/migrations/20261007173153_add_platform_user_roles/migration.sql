-- CreateEnum
CREATE TYPE "PlatformUserRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- AlterTable
-- Existing PlatformUser records predate platform RBAC and had full platform
-- authority. Backfill those legacy identities as OWNER, then remove the
-- default so every future PlatformUser must receive an explicit role.
ALTER TABLE "PlatformUser"
ADD COLUMN "role" "PlatformUserRole" NOT NULL DEFAULT 'OWNER';

ALTER TABLE "PlatformUser"
ALTER COLUMN "role" DROP DEFAULT;