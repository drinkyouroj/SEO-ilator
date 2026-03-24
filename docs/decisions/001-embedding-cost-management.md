# DECISION: Embedding Cost Management

**Date:** 2026-03-23
**Status:** Accepted

## Context

Semantic similarity -- one of the two crosslink matching approaches in the PRD -- requires embedding every article via an external API (OpenAI or Cohere). For Pro tier users with up to 2,000 articles, a full re-embedding on every analysis run generates meaningful API cost and latency with zero incremental value when content has not changed. The PRD's `bodyHash` field on the Article model was designed with this problem in mind (Section 13, Question 1). We need a formal decision on the caching strategy, cache invalidation triggers, storage mechanism, and the schema additions required.

## Options Considered

1. **Cache aggressively using bodyHash, re-embed only on content change** -- Store embeddings in PostgreSQL via pgvector alongside a `bodyHash` (SHA-256) and `embeddingModel` identifier. Skip the embedding API call when the hash and model match. Pros: near-zero API cost for repeat analysis of unchanged content, fast re-analysis, simple implementation using existing schema primitives. Cons: requires careful hash normalization across all three ingestion paths; minor edits (typo fixes) trigger re-embedding even when semantic meaning is unchanged.

2. **Re-embed on every analysis run** -- Treat embeddings as ephemeral and regenerate them each time. Pros: guarantees freshness, no cache invalidation logic needed. Cons: a Pro user with 2,000 articles running analysis 5 times/month generates ~10,000 unnecessary embedding API calls; costs $0.50-2.00 per run that could be $0; hits OpenAI rate limits; makes re-analysis feel slow (minutes instead of seconds).

3. **Time-based cache expiry (e.g., re-embed if older than 7 days)** -- Treat embeddings as valid for a fixed window regardless of content changes. Pros: simple logic. Cons: wasteful for static content (most articles never change); stale for articles that change within the window; does not align with how content actually evolves.

## Decision

**Option 1: Cache aggressively using bodyHash + embeddingModel, re-embed only on change.**

All six specialists unanimously agreed on this approach. The Backend Engineer's argument is most concrete: "a user triggering re-analysis 10 times a month without content changes burns dollars for zero value." The SEO Expert confirmed the domain reality: "published article content changes infrequently -- articles are essentially static for months or years after the first 48 hours." The Client Success advocate framed this as the critical retention lever: "the second run must feel dramatically faster than the first, or users will conclude the product is slow."

### Implementation specifics

**Schema additions (single Prisma migration):**
- Add `embedding vector(1536)` column on the `Article` table using pgvector (raw SQL in migration for pgvector DDL).
- Add `embeddingModel String?` column (e.g., `"openai/text-embedding-3-small"`). Used for invalidation when the provider changes.
- Create an HNSW index on the `embedding` column for cosine distance queries, per the DBA's recommendation (faster than IVFFlat for indexes under 100K rows, no training step required).

**Cache check logic (in `src/lib/embeddings/`):**
Before calling the embedding provider for an article, check: `article.bodyHash === newHash AND article.embeddingModel === currentModel AND article.embedding IS NOT NULL`. If all three match, skip the API call.

**Hash scope:** Hash `title + body` (not body alone), per the Backend Engineer's recommendation. Title changes affect crosslink matching and should trigger re-embedding.

**Monitoring:** Store `embeddingsCached` and `embeddingsGenerated` counters on each `AnalysisRun` record, per the DevOps engineer's recommendation. Surface these in the dashboard run detail view.

**First-run cost transparency:** The Frontend Engineer's suggestion to show a pre-run summary ("X articles need new embeddings, Y cached, estimated cost: $Z") should be implemented on the `/dashboard/analyze` page.

**Force re-embed:** Provide a "Force re-embed all" toggle in `/dashboard/settings` under an Advanced section, for edge cases like corrupted data.

## Consequences

- Re-analysis of an unchanged 2,000-article index costs zero embedding API calls and completes in seconds instead of minutes.
- First-time analysis remains the slow/expensive operation. Users should be set expectations via the pre-run cost estimate UI.
- Prisma cannot natively query pgvector. Similarity searches will use `prisma.$queryRaw` with the cosine distance operator (`<=>`), creating a split in data access patterns (Prisma for CRUD, raw SQL for vector ops). This is an accepted trade-off.
- Switching embedding providers requires a bulk re-embed. The `embeddingModel` column ensures this happens automatically on the next analysis run, but users should be warned in Settings when they change providers.
- Storage overhead is minimal: ~6 KB per article for a 1536-dimension vector. At 1,000 tenants with 2,000 articles each, total vector storage is ~12 GB.

## AAP: Embedding Cost Management

### ARCHITECT

Cache embeddings in PostgreSQL using pgvector. The `Article` table gains two columns: `embedding vector(1536)` and `embeddingModel String?`. An HNSW index covers the similarity query pattern (`ORDER BY embedding <=> $1 LIMIT N`). The `bodyHash` field (already in the schema) serves as the cache key. The embedding provider abstraction in `src/lib/embeddings/` wraps the cache check: compute SHA-256 of `title + body`, compare to stored `bodyHash`, compare `embeddingModel` to the configured provider, and only call the external API on mismatch. Each `AnalysisRun` tracks `embeddingsCached: Int` and `embeddingsGenerated: Int` for cost observability.

Failure mode: if the hash normalization differs between ingestion methods (sitemap crawler vs. file upload vs. API push), the same content could produce different hashes, causing unnecessary re-embeddings. Mitigation: normalize all content through the same `normalizer.ts` pipeline before hashing, regardless of ingestion source.

### ADVERSARY

**Objection 1:** Hashing `title + body` means a trivial title tweak (capitalizing a word, adding a subtitle) triggers a full re-embedding even when the semantic meaning is identical. For a user updating titles across 500 articles (a common SEO task), this defeats the cache entirely and generates an unexpected cost spike. The hash should cover body only, with title changes handled by a separate, cheaper mechanism (like re-running keyword matching without re-embedding).

**Objection 2:** Storing embeddings as `vector(1536)` hard-codes the OpenAI dimension size into the schema. Cohere's `embed-english-v3.0` produces 1024-dimension vectors. If a user switches from OpenAI to Cohere, the column type is wrong. A migration to change the vector dimension requires dropping and recreating the column (and the HNSW index), which means downtime and data loss for all cached embeddings on that instance.

### JUDGE

**Verdict:** Accept the caching design with two modifications addressing ADVERSARY's objections.

On Objection 1: The ADVERSARY's concern about title-only changes triggering unnecessary re-embeddings is valid but overstated. Title changes affect the semantic representation meaningfully (the title is a strong signal for topic classification). However, the cost risk for bulk title updates is real. **Modification:** Hash body only for the `bodyHash` field. Add a separate `titleHash` field. Re-embed when either hash changes, but log which hash triggered it so the team can evaluate whether title-only re-embeddings are wasteful in practice and adjust later.

On Objection 2: This is a genuine schema fragility. **Modification:** Use `vector` without a fixed dimension specifier if pgvector supports it (pgvector 0.5.0+ supports variable-length vectors). If the Railway pgvector version requires a fixed dimension, use the larger size (`vector(1536)`) and zero-pad shorter vectors, accepting the minor storage overhead. Document the provider-dimension mapping in `src/lib/embeddings/providers.ts`. When a provider switch occurs, drop and recreate the HNSW index for the new dimension -- this is acceptable because provider switches are rare and the re-embed is already required.
