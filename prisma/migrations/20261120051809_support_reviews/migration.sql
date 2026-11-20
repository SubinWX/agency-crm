-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "ratedAt" TIMESTAMPTZ(3),
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "ratingComment" TEXT;
