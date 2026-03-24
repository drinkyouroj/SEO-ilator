-- Add lastHeartbeatAt column
ALTER TABLE "AnalysisRun" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

-- [AAP-B3] Partial unique index prevents concurrent active analysis runs per project
CREATE UNIQUE INDEX "AnalysisRun_projectId_active_unique"
ON "AnalysisRun" ("projectId")
WHERE status IN ('pending', 'running');
