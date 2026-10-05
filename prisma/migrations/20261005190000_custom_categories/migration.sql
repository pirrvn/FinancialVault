-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "systemKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultsVersion" INTEGER NOT NULL DEFAULT 0;

-- Backfill: built-in categories are identified by their original name from now on.
UPDATE "Category" SET "systemKey" = "name" WHERE "isSystem" = true;

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_systemKey_key" ON "Category"("userId", "systemKey");
