-- CreateEnum
CREATE TYPE "IoiTieBreak" AS ENUM ('TIME', 'SHARED');

-- AlterTable
ALTER TABLE "Contest" ADD COLUMN     "ioiTieBreak" "IoiTieBreak" NOT NULL DEFAULT 'TIME';
