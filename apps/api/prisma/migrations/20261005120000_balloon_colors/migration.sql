-- CreateEnum
CREATE TYPE "BalloonPalette" AS ENUM ('ICPC', 'CUSTOM');

-- AlterTable
ALTER TABLE "Contest" ADD COLUMN     "balloonPalette" "BalloonPalette" NOT NULL DEFAULT 'ICPC';

-- AlterTable
ALTER TABLE "Problem" ADD COLUMN     "balloonColor" TEXT;
