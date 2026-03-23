/**
 * Post-migration script to add pgvector embedding column and HNSW index.
 *
 * Prisma v7's migration engine silently skips SQL containing custom
 * extension types (e.g., vector(1536)). This script runs after
 * `prisma migrate deploy` to apply the pgvector column and index.
 *
 * Usage: npx tsx prisma/pgvector-setup.ts
 * Requires: DATABASE_URL environment variable
 */
import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[pgvector-setup] DATABASE_URL is required");
  process.exit(1);
}

const sql = `
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Article' AND column_name = 'embedding'
  ) THEN
    EXECUTE 'ALTER TABLE "Article" ADD COLUMN "embedding" vector(1536)';
    RAISE NOTICE 'Added embedding column';
  ELSE
    RAISE NOTICE 'Embedding column already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'Article_embedding_hnsw_idx'
  ) THEN
    EXECUTE 'CREATE INDEX "Article_embedding_hnsw_idx" ON "Article" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
    RAISE NOTICE 'Created HNSW index';
  ELSE
    RAISE NOTICE 'HNSW index already exists';
  END IF;
END $$;
`;

console.log("[pgvector-setup] Applying pgvector column and index...");

try {
  // Try local psql first
  execFileSync("psql", [url, "-c", sql], { stdio: "inherit" });
  console.log("[pgvector-setup] Done.");
} catch {
  // Fall back to docker compose psql
  console.log("[pgvector-setup] Local psql not available, trying docker...");
  try {
    execFileSync(
      "docker",
      ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "seoilator", "-c", sql],
      { stdio: "inherit" }
    );
    console.log("[pgvector-setup] Done (via docker).");
  } catch (e) {
    console.error("[pgvector-setup] Failed:", e);
    process.exit(1);
  }
}
