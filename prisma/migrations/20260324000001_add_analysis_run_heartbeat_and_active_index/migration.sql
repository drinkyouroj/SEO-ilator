-- Add lastHeartbeatAt column for zombie recovery liveness detection
ALTER TABLE "AnalysisRun" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

-- Note: The AAP-B3 partial unique index (AnalysisRun_projectId_active_unique)
-- already exists from migration 20260323191901_add_analysis_and_recommendations.
