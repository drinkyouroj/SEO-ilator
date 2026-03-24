-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "titleHash" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "metadata" JSONB,
    "sourceType" TEXT,
    "httpStatus" INTEGER,
    "existingLinks" JSONB,
    "parseWarning" TEXT,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Article_projectId_updatedAt_idx" ON "Article"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "Article_projectId_bodyHash_idx" ON "Article"("projectId", "bodyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Article_projectId_url_key" ON "Article"("projectId", "url");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
