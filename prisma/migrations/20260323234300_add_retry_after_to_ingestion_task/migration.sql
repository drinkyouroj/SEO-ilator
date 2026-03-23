-- AlterTable
ALTER TABLE "IngestionTask" ADD COLUMN "retryAfter" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "IngestionTask_status_retryAfter_idx" ON "IngestionTask"("status", "retryAfter");
