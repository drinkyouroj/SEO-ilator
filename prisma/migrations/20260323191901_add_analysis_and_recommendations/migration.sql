-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "strategiesUsed" JSONB NOT NULL,
    "configuration" JSONB NOT NULL,
    "articleCount" INTEGER NOT NULL DEFAULT 0,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "embeddingsCached" INTEGER NOT NULL DEFAULT 0,
    "embeddingsGenerated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "sourceArticleId" TEXT NOT NULL,
    "targetArticleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "anchorText" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchingApproach" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dismissReason" TEXT,
    "sourceContext" TEXT,
    "charOffsetStart" INTEGER,
    "charOffsetEnd" INTEGER,
    "suggestion" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisRun_projectId_status_idx" ON "AnalysisRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "AnalysisRun_projectId_createdAt_idx" ON "AnalysisRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_projectId_analysisRunId_status_severity_idx" ON "Recommendation"("projectId", "analysisRunId", "status", "severity");

-- CreateIndex
CREATE INDEX "Recommendation_sourceArticleId_status_idx" ON "Recommendation"("sourceArticleId", "status");

-- CreateIndex
CREATE INDEX "Recommendation_targetArticleId_idx" ON "Recommendation"("targetArticleId");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_analysisRunId_sourceArticleId_targetArticleI_key" ON "Recommendation"("analysisRunId", "sourceArticleId", "targetArticleId", "strategyId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyConfig_projectId_strategyId_key" ON "StrategyConfig"("projectId", "strategyId");

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_sourceArticleId_fkey" FOREIGN KEY ("sourceArticleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_targetArticleId_fkey" FOREIGN KEY ("targetArticleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyConfig" ADD CONSTRAINT "StrategyConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [AAP-B3] Prevent concurrent analysis runs per project at the database level.
-- Only one AnalysisRun per project can be in 'pending' or 'running' status at a time.
CREATE UNIQUE INDEX "AnalysisRun_projectId_active_unique"
  ON "AnalysisRun" ("projectId")
  WHERE status IN ('pending', 'running');
