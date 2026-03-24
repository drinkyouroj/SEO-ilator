# Phase 4: Embedding Provider & Cache — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Phase:** 4 of 9
**Depends on:** Phase 1 (schema with pgvector), Phase 3 (articles in database)

---

## Overview

Phase 4 builds the embedding provider abstraction layer, caching system, batch processor, and pgvector similarity queries. Articles ingested in Phase 3 can now be embedded via OpenAI or Cohere, with embeddings cached in PostgreSQL and queried for semantic similarity. This phase is all library code — no API routes.

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Provider support at launch | OpenAI + Cohere (provider-agnostic abstraction) | Full abstraction built, both adapters shipped |
| Cohere adapter | Direct `fetch`, no SDK | Single endpoint, no extra dependency |
| Provider config storage | Database-first (`StrategyConfig` table), env var as fallback | Per-project provider selection is core to multi-tenant design |
| Implementation approach | Parallel agents per existing TDD agent team spec | Clean file boundaries, faster execution |
| Vector storage dimensions | Fixed `vector(1536)`, zero-pad shorter vectors | Per DECISION-001 JUDGE, avoids schema migration on provider switch |
| Cache invalidation | Clear `embedding`/`embeddingModel` on content change during ingestion | Simple, no extra hash columns needed |

## Module Specifications

### 1. Types — `src/lib/embeddings/types.ts`

Core contract for all embedding providers:

```typescript
interface EmbeddingProvider {
  modelId: string;        // e.g. "openai/text-embedding-3-small"
  dimensions: number;     // native output dimensions (1536 for OpenAI, 1024 for Cohere)
  batchSize: number;      // max texts per API call (2048 for OpenAI, 96 for Cohere)
  embed(texts: string[]): Promise<number[][]>;  // vectors in same order as input
}

interface CacheCheckResult {
  cached: Article[];          // embedding valid, skip API call
  needsGeneration: Article[]; // needs new embedding
}

interface SimilarArticle {
  id: string;
  url: string;
  title: string;
  similarity: number;  // cosine similarity 0-1
}
```

### 2. Provider Dimensions — `src/lib/embeddings/providers.ts`

Static mapping used by zero-padding and provider switching validation:

```typescript
const PROVIDER_DIMENSIONS: Record<string, number> = {
  "openai/text-embedding-3-small": 1536,
  "cohere/embed-english-v3.0": 1024,
};
const STORAGE_DIMENSIONS = 1536;  // All vectors stored at this fixed size
```

### 3. OpenAI Adapter — `src/lib/embeddings/providers/openai.ts`

Uses the installed `openai` SDK (`^6.32.0`):

- Model: `text-embedding-3-small` (1536 dims)
- Batch limit: 2048 texts per API call
- Auth: `OPENAI_API_KEY` env var (SDK reads it automatically)
- Returns `number[][]` in input order
- Throws on API errors — caller handles retries

### 4. Cohere Adapter — `src/lib/embeddings/providers/cohere.ts`

Direct `fetch` to Cohere's REST API (no SDK):

- Model: `embed-english-v3.0` (1024 dims)
- Endpoint: `POST https://api.cohere.ai/v2/embed`
- Auth: `COHERE_API_KEY` env var, `Authorization: Bearer` header
- Input type: `search_document` for indexing
- Batch limit: 96 texts per call
- Returns 1024-dim vectors (zero-padded to 1536 by the batch processor before storage)

### 5. Factory — `src/lib/embeddings/index.ts`

```typescript
getProvider(projectId: string): Promise<EmbeddingProvider>
```

1. Query `StrategyConfig` where `projectId` + `strategyId: "embedding"`
2. If found, read `settings.provider` (e.g. `"openai/text-embedding-3-small"`)
3. If not found, fall back to `process.env.EMBEDDING_PROVIDER ?? "openai/text-embedding-3-small"`
4. Return the corresponding adapter instance
5. Throw if the model ID is not in `PROVIDER_DIMENSIONS`

### 6. Cache Check — `src/lib/embeddings/cache.ts`

Pure function, no database calls:

```typescript
checkEmbeddingCache(
  articles: ArticleWithEmbedding[],
  currentModelId: string,
  currentHashes: Map<string, { bodyHash: string; titleHash: string }>
): CacheCheckResult
```

An article is **cached** when ALL of these are true (per DECISION-001):
- `article.embeddingModel === currentModelId`
- `article.embedding IS NOT NULL`
- `article.bodyHash === currentHashes.get(article.id).bodyHash` (defensive — ensures embedding matches current content)
- `article.titleHash === currentHashes.get(article.id).titleHash`

Everything else → **needs generation**.

**Defense in depth:** The primary cache invalidation mechanism is at ingestion time — when `bodyHash` or `titleHash` changes during upsert, the ingestion pipeline clears `embedding = NULL` and `embeddingModel = NULL`. The hash comparison in the cache check is a defensive secondary check that catches cases where the ingestion pipeline failed to clear the embedding (e.g., a route was missed during patching, or a future code change regresses the invalidation). This matches DECISION-001's specified cache key triple.

**Implementation note:** The `currentHashes` map is computed by the caller (the analysis orchestrator in Phase 5) by running the normalizer on the current article content. For Phase 4's cache check, the hashes are simply read from the Article record — since the normalizer already wrote them during ingestion, `article.bodyHash` IS the current hash. The map parameter exists to support a future scenario where the analysis orchestrator re-normalizes before checking the cache.

### 7. Batch Processor — `src/lib/embeddings/batch.ts`

Orchestrates the embed-and-store flow:

```typescript
processEmbeddings(
  projectId: string,
  articles: ArticleWithEmbedding[],
  provider: EmbeddingProvider
): Promise<{ cached: number; generated: number; skipped: number }>
```

1. Call `checkEmbeddingCache(articles, provider.modelId, currentHashes)` to split cached vs needs-generation
2. **Pre-filter:** Remove articles where `(title + body).trim().length === 0` from the needs-generation list. Add these to a `skipped` counter and log a warning. These articles cannot be embedded (providers reject empty input).
3. For needs-generation (after pre-filter): chunk into batches using `provider.batchSize` (see EmbeddingProvider interface)
3. For each batch: call `provider.embed(texts)` where text = `article.title + "\n\n" + article.body`
4. **Zero-pad** if `provider.dimensions < STORAGE_DIMENSIONS` (append zeros to reach 1536)
5. Store via raw SQL: `UPDATE "Article" SET embedding = $vector, "embeddingModel" = $modelId WHERE id = $articleId`
6. Return `{ cached, generated }` counts for `AnalysisRun.embeddingsCached` / `embeddingsGenerated`

### 8. Similarity Queries — `src/lib/embeddings/similarity.ts`

pgvector cosine distance via raw SQL:

```typescript
findSimilarArticles(
  projectId: string,
  articleId: string,
  limit?: number,      // default: 10
  threshold?: number   // default: 0.5, minimum cosine similarity
): Promise<SimilarArticle[]>
```

- Fetches the source article's embedding
- Sets `SET LOCAL hnsw.ef_search = 100` for recall quality
- Queries: `SELECT id, url, title, 1 - (embedding <=> $source) AS similarity FROM "Article" WHERE "projectId" = $pid AND id != $sourceId AND embedding IS NOT NULL AND 1 - (embedding <=> $source) >= $threshold ORDER BY embedding <=> $source LIMIT $limit`
- Threshold is pushed into the SQL `WHERE` clause to avoid scanning beyond relevant results
- Returns `{ id, url, title, similarity }` ranked descending

All queries use `prisma.$queryRaw`.

### 9. Provider Switching — `src/lib/embeddings/switch.ts`

Implements AAP-B6's atomic provider switch:

```typescript
switchProvider(projectId: string, newModelId: string): Promise<void>
```

1. Validate `newModelId` exists in `PROVIDER_DIMENSIONS` — throw if unknown
2. In a single transaction:
   - Clear all embeddings: `UPDATE "Article" SET embedding = NULL, "embeddingModel" = NULL WHERE "projectId" = $1`
   - Upsert `StrategyConfig` with `strategyId: "embedding"`, `settings: { provider: newModelId }`
3. After the transaction: issue `REINDEX INDEX CONCURRENTLY "Article_embedding_hnsw_idx"` to rebuild the HNSW index (name matches `prisma/pgvector-setup.ts` line 36) after bulk nullification (per DECISION-001 JUDGE verdict on Objection 2). This runs outside the transaction since `REINDEX CONCURRENTLY` cannot run inside one. If the reindex fails, log a warning but don't fail the switch — the index will still work, just with degraded performance until the next re-embed populates it.
4. Next analysis run will re-embed all articles with the new provider

Called by the settings API in Phase 7.

## Ingestion Pipeline Update

Add embedding invalidation to all four article upsert paths. The approach differs by route:

**Blind-upsert routes** (`cron/crawl/route.ts`, `articles/route.ts` sync path): These routes `upsert` with no pre-read — they always overwrite content. Embedding nullification must be **unconditional on the update path** because the new `bodyHash` has already replaced the old one, making any existing embedding potentially stale:
```typescript
update: {
  // ... existing fields ...
  embedding: null,          // Always invalidate — content may have changed
  embeddingModel: null,
}
```
This is safe-but-slightly-wasteful (re-crawling unchanged content nullifies a valid embedding, which is then regenerated on the next analysis run). The waste is minimal: re-embedding only happens if the user runs analysis, and the cache check provides a second line of defense.

**Hash-comparing routes** (`articles/upload/route.ts`, `articles/push/route.ts`): These routes compare `bodyHash` before deciding to update (skip if unchanged). When the update path runs, the content HAS changed, so embedding nullification is both correct and targeted:
```typescript
// Only reaches here when bodyHash changed
update: {
  // ... existing fields ...
  embedding: null,
  embeddingModel: null,
}
```

**Note:** Since the `embedding` column is managed by `pgvector-setup.ts` (raw SQL, not in Prisma schema), these updates must use `prisma.$executeRaw` or the column must be added to the Prisma schema as `Unsupported("vector(1536)")?`. The implementation should use raw SQL for the nullification: `UPDATE "Article" SET embedding = NULL, "embeddingModel" = NULL WHERE id = $1` as a separate statement after the Prisma upsert, OR add a Prisma-compatible approach. The implementer should determine the best approach at build time.

## AAP Requirements Coverage

| AAP ID | Requirement | Where addressed |
|---|---|---|
| AAP-B6 | Provider switch atomically clears embeddings, warns user | `switch.ts` — transaction clears all embeddings + updates config |
| AAP-B6 | Never allow mixed-dimension vectors | `batch.ts` — zero-pads all vectors to `STORAGE_DIMENSIONS` (1536) |
| AAP-B6 | Settings endpoint warns user | Deferred to Phase 7 (settings UI) — `switch.ts` is the library function |

## Testing Plan

| Test file | Tests | What's tested |
|---|---|---|
| `tests/lib/embeddings/cache.test.ts` | 6 | Cache hit/miss classification — model match, embedding presence, mixed batches |
| `tests/lib/embeddings/providers/openai.test.ts` | 3 | Correct dimensions, batch input, API error propagation |
| `tests/lib/embeddings/providers/cohere.test.ts` | 3 | Correct dimensions, auth header/model, API error propagation |
| `tests/lib/embeddings/batch.test.ts` | 6 | Skip cached, zero-padding, batch chunking, empty article list, empty body skipped, provider error mid-batch |
| `tests/lib/embeddings/similarity.test.ts` | 4 | Sorted results, source article excluded, no-embedding source returns empty, threshold filtering |
| `tests/lib/embeddings/switch.test.ts` | 2 | Atomic clear + config update, unknown model rejection |

Total: 25 new tests.

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/lib/embeddings/types.ts` | EmbeddingProvider interface, CacheCheckResult, SimilarArticle |
| `src/lib/embeddings/providers.ts` | PROVIDER_DIMENSIONS map, STORAGE_DIMENSIONS constant |
| `src/lib/embeddings/providers/openai.ts` | OpenAI adapter (SDK-based) |
| `src/lib/embeddings/providers/cohere.ts` | Cohere adapter (direct fetch) |
| `src/lib/embeddings/index.ts` | `getProvider()` factory |
| `src/lib/embeddings/cache.ts` | `checkEmbeddingCache()` pure function |
| `src/lib/embeddings/batch.ts` | `processEmbeddings()` orchestrator |
| `src/lib/embeddings/similarity.ts` | `findSimilarArticles()` pgvector queries |
| `src/lib/embeddings/switch.ts` | `switchProvider()` atomic provider change [AAP-B6] |

### Files to modify

| File | Change |
|---|---|
| `src/app/api/cron/crawl/route.ts` | Add `embedding: null, embeddingModel: null` to upsert update block when content changed |
| `src/app/api/articles/route.ts` | Same — add embedding invalidation to sync path upsert |
| `src/app/api/articles/upload/route.ts` | Same — add to upsertArticle helper update block |
| `src/app/api/articles/push/route.ts` | Same — add to update block |

## Implementation Order

1. Types + provider dimensions (shared foundation)
2. OpenAI adapter (TDD)
3. Cohere adapter (TDD)
4. Factory (`getProvider`)
5. Cache check (TDD)
6. Batch processor (TDD)
7. Similarity queries (TDD)
8. Provider switching (TDD)
9. Ingestion pipeline embedding invalidation
10. Full test suite verification
11. Update build_log.md
