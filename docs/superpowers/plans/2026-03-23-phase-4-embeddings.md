# Phase 4: Embedding Provider & Cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build embedding provider abstraction, OpenAI/Cohere integrations, cache-check logic, and pgvector similarity queries.

**Architecture:** Provider interface abstracts embedding APIs. Cache uses bodyHash + titleHash + embeddingModel for invalidation. Similarity via pgvector cosine distance with HNSW index.

**Tech Stack:** OpenAI SDK, pgvector, Prisma raw SQL

**Agent Team:** Provider Agent ∥ TDD Agent (fully parallel, no file overlap)

**Prerequisites:** Phase 1 (schema with pgvector), Phase 3 (articles in database)

---

## Table of Contents

1. [Provider Agent: Task 4.1 — EmbeddingProvider Interface](#provider-agent-task-41--embeddingprovider-interface)
2. [Provider Agent: Task 4.2 — OpenAI Provider](#provider-agent-task-42--openai-provider)
3. [Provider Agent: Task 4.3 — Cohere Provider](#provider-agent-task-43--cohere-provider)
4. [Provider Agent: Task 4.4 — Provider Factory & Dimensions Map](#provider-agent-task-44--provider-factory--dimensions-map)
5. [TDD Agent: Task 4.5 — Cache Check Logic (RED/GREEN)](#tdd-agent-task-45--cache-check-logic-redgreen)
6. [TDD Agent: Task 4.6 — Batch Processor (RED/GREEN)](#tdd-agent-task-46--batch-processor-redgreen)
7. [TDD Agent: Task 4.7 — Vector Similarity Queries](#tdd-agent-task-47--vector-similarity-queries)
8. [Integration Verification](#integration-verification)

---

## Provider Agent: Task 4.1 — EmbeddingProvider Interface

> **Branch:** `feature/phase-4-provider`
> **Depends on:** Phase 1 complete (Prisma schema with pgvector)

### Step 4.1.1 — Create the branch

- [ ] Create and switch to `feature/phase-4-provider` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-4-provider
```

**Expected:** Branch created. `git branch --show-current` outputs `feature/phase-4-provider`.

### Step 4.1.2 — Create the embeddings directory structure

- [ ] Create the directory structure for embedding files

```bash
mkdir -p src/lib/embeddings/providers
```

**Expected:** Directories `src/lib/embeddings/` and `src/lib/embeddings/providers/` exist.

### Step 4.1.3 — Write the EmbeddingProvider interface

- [ ] Create `src/lib/embeddings/types.ts` with the complete interface definitions

**File:** `src/lib/embeddings/types.ts`

```typescript
/**
 * Embedding provider abstraction for SEO-ilator.
 *
 * All embedding providers (OpenAI, Cohere, etc.) implement the EmbeddingProvider
 * interface. The cache layer uses CacheCheckResult to determine which articles
 * need fresh embeddings vs. which can reuse stored vectors.
 *
 * Per DECISION-001: cache invalidation is based on bodyHash + titleHash + embeddingModel.
 */

/**
 * Contract for all embedding providers.
 *
 * - modelId: fully qualified identifier, e.g. "openai/text-embedding-3-small"
 * - dimensions: native output dimensions (before any zero-padding)
 * - embed(): accepts an array of text strings, returns an array of embedding vectors
 */
export interface EmbeddingProvider {
  /** Fully qualified model identifier, e.g. "openai/text-embedding-3-small" */
  readonly modelId: string;

  /** Native embedding dimensions for this provider (e.g. 1536 for OpenAI, 1024 for Cohere) */
  readonly dimensions: number;

  /**
   * Generate embeddings for an array of text strings.
   *
   * @param texts - Array of input texts to embed
   * @returns Array of embedding vectors (number[][]), one per input text, in the same order
   * @throws Error if the API call fails or rate-limits are exceeded
   */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Result of checking the embedding cache for a batch of articles.
 *
 * - cached: articles whose stored embedding is still valid (hashes + model match)
 * - needsGeneration: articles that need fresh embeddings
 */
export interface CacheCheckResult {
  cached: ArticleEmbeddingState[];
  needsGeneration: ArticleEmbeddingState[];
}

/**
 * Minimal article shape needed for embedding cache checks and batch processing.
 * This is NOT the full Prisma Article model — it is the subset of fields
 * relevant to the embedding pipeline.
 */
export interface ArticleEmbeddingState {
  id: string;
  title: string;
  body: string;
  bodyHash: string;
  titleHash: string;
  embeddingModel: string | null;
  /** null when no embedding has been generated yet */
  embedding: number[] | null;
}

/**
 * A single similarity search result.
 */
export interface SimilarArticle {
  id: string;
  title: string;
  url: string;
  /** Cosine distance (0 = identical, 2 = opposite) */
  distance: number;
}
```

**Verify:**

```bash
npx tsc --noEmit src/lib/embeddings/types.ts 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 4.1.4 — Commit the interface

- [ ] Commit the types file

```bash
git add src/lib/embeddings/types.ts
git commit -m "feat(embeddings): add EmbeddingProvider interface and related types

Defines EmbeddingProvider contract (modelId, dimensions, embed), CacheCheckResult,
ArticleEmbeddingState, and SimilarArticle types. Per DECISION-001."
```

**Expected:** Clean commit on `feature/phase-4-provider`.

---

## Provider Agent: Task 4.2 — OpenAI Provider

> **Branch:** `feature/phase-4-provider` (continues from 4.1)
> **Depends on:** Task 4.1 (types.ts)

### Step 4.2.1 — Verify openai SDK is installed

- [ ] Check that the `openai` package is in `package.json`

```bash
grep '"openai"' package.json
```

If missing, install it:

```bash
npm install openai
```

**Expected:** `openai` appears in `dependencies`.

### Step 4.2.2 — Write the OpenAI provider implementation

- [ ] Create `src/lib/embeddings/providers/openai.ts`

**File:** `src/lib/embeddings/providers/openai.ts`

```typescript
import OpenAI from "openai";
import type { EmbeddingProvider } from "../types";

/**
 * OpenAI embedding provider using text-embedding-3-small.
 *
 * - Model: text-embedding-3-small
 * - Dimensions: 1536
 * - Max batch size per API call: 2048 inputs
 *
 * Reads OPENAI_API_KEY from environment. Throws on instantiation if missing.
 */

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 2048;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = `openai/${MODEL}`;
  readonly dimensions = DIMENSIONS;

  private client: OpenAI;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey to constructor."
      );
    }
    this.client = new OpenAI({ apiKey: key });
  }

  /**
   * Generate embeddings for an array of text strings.
   *
   * If the input exceeds MAX_BATCH_SIZE (2048), it is automatically chunked
   * into sequential API calls. Results are concatenated in input order.
   *
   * @param texts - Array of input texts to embed
   * @returns Array of embedding vectors, one per input text
   * @throws Error on API failure
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const allEmbeddings: number[][] = [];

    // Process in chunks of MAX_BATCH_SIZE
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const chunk = texts.slice(i, i + MAX_BATCH_SIZE);

      const response = await this.client.embeddings.create({
        model: MODEL,
        input: chunk,
        dimensions: DIMENSIONS,
      });

      // OpenAI returns embeddings sorted by index, but we sort explicitly
      // to guarantee order matches input order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      const embeddings = sorted.map((item) => item.embedding);

      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }
}
```

**Verify:**

```bash
npx tsc --noEmit src/lib/embeddings/providers/openai.ts 2>&1 | head -5
# Expected: no errors
```

### Step 4.2.3 — Commit the OpenAI provider

- [ ] Commit the implementation

```bash
git add src/lib/embeddings/providers/openai.ts
git commit -m "feat(embeddings): add OpenAI embedding provider

Implements EmbeddingProvider for text-embedding-3-small (1536 dims).
Auto-chunks batches exceeding 2048 inputs. Reads OPENAI_API_KEY from env."
```

**Expected:** Clean commit.

---

## Provider Agent: Task 4.3 — Cohere Provider

> **Branch:** `feature/phase-4-provider` (continues from 4.2)
> **Depends on:** Task 4.1 (types.ts)

### Step 4.3.1 — Install Cohere SDK

- [ ] Install the `cohere-ai` package

```bash
npm install cohere-ai
```

**Expected:** `cohere-ai` appears in `dependencies`.

### Step 4.3.2 — Write the Cohere provider implementation

- [ ] Create `src/lib/embeddings/providers/cohere.ts`

**File:** `src/lib/embeddings/providers/cohere.ts`

```typescript
import { CohereClient } from "cohere-ai";
import type { EmbeddingProvider } from "../types";

/**
 * Cohere embedding provider using embed-english-v3.0.
 *
 * - Model: embed-english-v3.0
 * - Dimensions: 1024 (native; zero-padded to 1536 at storage time by batch processor)
 * - Max batch size per API call: 96 inputs (Cohere limit)
 *
 * Reads COHERE_API_KEY from environment. Throws on instantiation if missing.
 *
 * IMPORTANT: This provider returns native 1024-dim vectors. The batch processor
 * (batch.ts) handles zero-padding to 1536 before database storage, per AAP-B6
 * and DECISION-001 JUDGE verdict. This provider does NOT pad internally.
 */

const MODEL = "embed-english-v3.0";
const DIMENSIONS = 1024;
const MAX_BATCH_SIZE = 96;

export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = `cohere/${MODEL}`;
  readonly dimensions = DIMENSIONS;

  private client: CohereClient;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.COHERE_API_KEY;
    if (!key) {
      throw new Error(
        "Cohere API key is required. Set COHERE_API_KEY environment variable or pass apiKey to constructor."
      );
    }
    this.client = new CohereClient({ token: key });
  }

  /**
   * Generate embeddings for an array of text strings.
   *
   * Cohere's embed endpoint accepts up to 96 texts per call.
   * Larger batches are automatically chunked.
   *
   * @param texts - Array of input texts to embed
   * @returns Array of 1024-dim embedding vectors (native dimensions, NOT zero-padded)
   * @throws Error on API failure
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const chunk = texts.slice(i, i + MAX_BATCH_SIZE);

      const response = await this.client.embed({
        model: MODEL,
        texts: chunk,
        inputType: "search_document",
      });

      // Cohere returns embeddings as float[][] in response.embeddings
      const embeddings = response.embeddings as number[][];
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }
}
```

**Verify:**

```bash
npx tsc --noEmit src/lib/embeddings/providers/cohere.ts 2>&1 | head -5
# Expected: no errors
```

### Step 4.3.3 — Commit the Cohere provider

- [ ] Commit the implementation

```bash
git add src/lib/embeddings/providers/cohere.ts
git commit -m "feat(embeddings): add Cohere embedding provider

Implements EmbeddingProvider for embed-english-v3.0 (1024 native dims).
Auto-chunks batches exceeding 96 inputs. Zero-padding to 1536 handled
by batch processor per AAP-B6."
```

**Expected:** Clean commit.

---

## Provider Agent: Task 4.4 — Provider Factory & Dimensions Map

> **Branch:** `feature/phase-4-provider` (continues from 4.3)
> **Depends on:** Tasks 4.2, 4.3 (provider implementations)

### Step 4.4.1 — Write the provider dimensions map

- [ ] Create `src/lib/embeddings/providers.ts`

**File:** `src/lib/embeddings/providers.ts`

```typescript
/**
 * Maps fully qualified provider model IDs to their native embedding dimensions.
 *
 * Used by the batch processor to determine if zero-padding is needed (when
 * native dimensions < storage column dimensions of 1536).
 *
 * To add a new provider: add its modelId and native dimension count here,
 * then create the provider class in providers/.
 */
export const PROVIDER_DIMENSIONS: Record<string, number> = {
  "openai/text-embedding-3-small": 1536,
  "cohere/embed-english-v3.0": 1024,
};

/**
 * The storage dimension for the pgvector column.
 * All embeddings must be padded to this size before storage.
 * Defined by the vector(1536) column in the Article table.
 */
export const STORAGE_DIMENSIONS = 1536;

/**
 * Supported provider names for the getProvider() factory.
 */
export type ProviderName = "openai" | "cohere";
```

**Verify:**

```bash
npx tsc --noEmit src/lib/embeddings/providers.ts 2>&1 | head -5
# Expected: no errors
```

### Step 4.4.2 — Write the provider factory with atomic switching

- [ ] Create `src/lib/embeddings/index.ts`

**File:** `src/lib/embeddings/index.ts`

```typescript
import { OpenAIEmbeddingProvider } from "./providers/openai";
import { CohereEmbeddingProvider } from "./providers/cohere";
import type { EmbeddingProvider } from "./types";
import type { ProviderName } from "./providers";
import { prisma } from "../db";

/**
 * Provider factory. Returns the configured embedding provider.
 *
 * Resolution order:
 * 1. Explicit providerName argument
 * 2. EMBEDDING_PROVIDER environment variable
 * 3. Default: "openai"
 *
 * @param providerName - "openai" or "cohere"
 * @returns An initialized EmbeddingProvider instance
 * @throws Error if the provider name is unrecognized
 */
export function getProvider(providerName?: string): EmbeddingProvider {
  const name = (
    providerName ??
    process.env.EMBEDDING_PROVIDER ??
    "openai"
  ).toLowerCase() as ProviderName;

  switch (name) {
    case "openai":
      return new OpenAIEmbeddingProvider();
    case "cohere":
      return new CohereEmbeddingProvider();
    default:
      throw new Error(
        `Unknown embedding provider: "${name}". Supported providers: openai, cohere.`
      );
  }
}

/**
 * [AAP-B6] Atomic provider switch.
 *
 * When switching embedding providers for a project, ALL existing embeddings
 * must be cleared to prevent mixed-dimension vectors. This forces a full
 * re-embed on the next analysis run.
 *
 * This function:
 * 1. Clears all embeddings for the project (sets embedding = NULL, embeddingModel = NULL)
 * 2. Returns the count of cleared articles for logging/UI feedback
 *
 * WARNING: This is destructive. The caller (settings endpoint) must confirm
 * with the user before invoking.
 *
 * @param projectId - The project whose embeddings should be cleared
 * @returns The number of articles whose embeddings were cleared
 */
export async function clearProjectEmbeddings(
  projectId: string
): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE "Article"
    SET "embedding" = NULL,
        "embeddingModel" = NULL
    WHERE "projectId" = ${projectId}
      AND "embedding" IS NOT NULL
  `;
  return result;
}

// Re-export types and constants for convenience
export type { EmbeddingProvider, CacheCheckResult, ArticleEmbeddingState, SimilarArticle } from "./types";
export { PROVIDER_DIMENSIONS, STORAGE_DIMENSIONS } from "./providers";
```

**Verify:**

```bash
npx tsc --noEmit src/lib/embeddings/index.ts 2>&1 | head -5
# Expected: no errors (may need to verify db.ts exists from Phase 1)
```

### Step 4.4.3 — Commit the factory and dimensions map

- [ ] Commit both files

```bash
git add src/lib/embeddings/providers.ts src/lib/embeddings/index.ts
git commit -m "feat(embeddings): add provider factory with atomic switching [AAP-B6]

getProvider() factory resolves from argument, env var, or defaults to OpenAI.
clearProjectEmbeddings() nullifies all embeddings for a project to prevent
mixed-dimension vectors. PROVIDER_DIMENSIONS maps modelId to native dims.
STORAGE_DIMENSIONS = 1536 for the pgvector column."
```

**Expected:** Clean commit. Provider Agent work is complete.

---

## TDD Agent: Task 4.5 — Cache Check Logic (RED/GREEN)

> **Branch:** `feature/phase-4-tdd`
> **Depends on:** Phase 1 complete (Prisma schema)
> **No file overlap with Provider Agent** — TDD Agent owns cache.ts, batch.ts, similarity.ts and all test files.

### Step 4.5.1 — Create the branch

- [ ] Create and switch to `feature/phase-4-tdd` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-4-tdd
```

**Expected:** Branch created.

### Step 4.5.2 — Create test directory structure

- [ ] Create the test directories

```bash
mkdir -p tests/lib/embeddings/providers
```

**Expected:** Directory exists.

### Step 4.5.3 — RED: Write 6 failing cache tests

- [ ] Create `tests/lib/embeddings/cache.test.ts` with all 6 test cases

**File:** `tests/lib/embeddings/cache.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { checkEmbeddingCache } from "@/lib/embeddings/cache";
import type { ArticleEmbeddingState } from "@/lib/embeddings/types";

/**
 * Cache check tests.
 *
 * An article is "cached" when ALL of these match:
 * - bodyHash matches (body hasn't changed)
 * - titleHash matches (title hasn't changed)
 * - embeddingModel === currentModel (provider hasn't changed)
 * - embedding IS NOT NULL (embedding exists)
 *
 * Otherwise the article "needs generation".
 */

// ── Test fixtures ──

function makeArticle(
  overrides: Partial<ArticleEmbeddingState> = {}
): ArticleEmbeddingState {
  return {
    id: overrides.id ?? "article-1",
    title: overrides.title ?? "Test Article",
    body: overrides.body ?? "This is the body of a test article.",
    bodyHash: overrides.bodyHash ?? "hash-body-original",
    titleHash: overrides.titleHash ?? "hash-title-original",
    embeddingModel: overrides.embeddingModel ?? "openai/text-embedding-3-small",
    embedding: overrides.embedding ?? Array(1536).fill(0.1),
  };
}

const CURRENT_MODEL = "openai/text-embedding-3-small";

// ── Tests ──

describe("checkEmbeddingCache", () => {
  it("returns_cached_when_all_hashes_match", () => {
    const article = makeArticle();

    const result = checkEmbeddingCache([article], CURRENT_MODEL);

    expect(result.cached).toHaveLength(1);
    expect(result.needsGeneration).toHaveLength(0);
    expect(result.cached[0].id).toBe("article-1");
  });

  it("returns_needs_generation_when_body_changed", () => {
    // Simulate body change: the article's bodyHash no longer matches what's stored.
    // In practice, the caller computes fresh hashes from current content and compares.
    // Here we simulate by giving the article a body whose hash WOULD differ,
    // but since checkEmbeddingCache compares stored hash vs freshHash,
    // we pass freshHashes to indicate a change.
    const article = makeArticle({
      bodyHash: "hash-body-CHANGED",
    });
    // The article still has an embedding and the same model,
    // but the stored bodyHash won't match the fresh hash.
    // We pass the original hashes as "current" to show mismatch.

    const result = checkEmbeddingCache(
      [article],
      CURRENT_MODEL,
      [{ articleId: "article-1", bodyHash: "hash-body-original", titleHash: "hash-title-original" }]
    );

    expect(result.cached).toHaveLength(0);
    expect(result.needsGeneration).toHaveLength(1);
    expect(result.needsGeneration[0].id).toBe("article-1");
  });

  it("returns_needs_generation_when_title_changed", () => {
    const article = makeArticle({
      titleHash: "hash-title-CHANGED",
    });

    const result = checkEmbeddingCache(
      [article],
      CURRENT_MODEL,
      [{ articleId: "article-1", bodyHash: "hash-body-original", titleHash: "hash-title-original" }]
    );

    expect(result.cached).toHaveLength(0);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("returns_needs_generation_when_model_changed", () => {
    const article = makeArticle({
      embeddingModel: "cohere/embed-english-v3.0",
    });

    const result = checkEmbeddingCache([article], CURRENT_MODEL);

    expect(result.cached).toHaveLength(0);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("returns_needs_generation_when_no_embedding", () => {
    const article = makeArticle({
      embedding: null,
    });

    const result = checkEmbeddingCache([article], CURRENT_MODEL);

    expect(result.cached).toHaveLength(0);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("splits_mixed_batch_correctly", () => {
    const cachedArticle = makeArticle({ id: "cached-1" });
    const bodyChanged = makeArticle({
      id: "body-changed",
      bodyHash: "hash-body-DIFFERENT",
    });
    const noEmbedding = makeArticle({
      id: "no-embedding",
      embedding: null,
    });
    const modelChanged = makeArticle({
      id: "model-changed",
      embeddingModel: "cohere/embed-english-v3.0",
    });

    const result = checkEmbeddingCache(
      [cachedArticle, bodyChanged, noEmbedding, modelChanged],
      CURRENT_MODEL,
      [
        { articleId: "body-changed", bodyHash: "hash-body-original", titleHash: "hash-title-original" },
      ]
    );

    expect(result.cached).toHaveLength(1);
    expect(result.cached[0].id).toBe("cached-1");

    expect(result.needsGeneration).toHaveLength(3);
    const needsIds = result.needsGeneration.map((a) => a.id).sort();
    expect(needsIds).toEqual(["body-changed", "model-changed", "no-embedding"]);
  });
});
```

**Commit the RED tests:**

```bash
git add tests/lib/embeddings/cache.test.ts
git commit -m "test(embeddings): RED — add 6 failing cache check tests

Tests for checkEmbeddingCache: cached when all match, needs generation
on body/title/model change, null embedding, and mixed batch splitting.
Implementation does not exist yet — all tests fail."
```

**Verify RED:**

```bash
npx vitest tests/lib/embeddings/cache.test.ts --run 2>&1 | tail -10
# Expected: 6 failing tests (module not found or assertion failures)
```

### Step 4.5.4 — GREEN: Write the cache check implementation

- [ ] Create `src/lib/embeddings/cache.ts` to make all 6 tests pass

**File:** `src/lib/embeddings/cache.ts`

```typescript
import type { ArticleEmbeddingState, CacheCheckResult } from "./types";

/**
 * Represents the "fresh" hash state for an article, used to detect
 * body or title changes since the last embedding was generated.
 *
 * If not provided for an article, the article's own stored hashes
 * are assumed to be current (no content change).
 */
export interface FreshHash {
  articleId: string;
  bodyHash: string;
  titleHash: string;
}

/**
 * Check which articles have valid cached embeddings and which need regeneration.
 *
 * An article's embedding is considered cached (valid) when ALL of:
 * 1. embedding IS NOT NULL (an embedding exists)
 * 2. embeddingModel === currentModel (same provider)
 * 3. bodyHash matches the fresh hash (body content unchanged)
 * 4. titleHash matches the fresh hash (title unchanged)
 *
 * @param articles - Articles to check, with their stored hash/model/embedding state
 * @param currentModel - The currently configured embedding model ID (e.g. "openai/text-embedding-3-small")
 * @param freshHashes - Optional array of fresh hashes for articles whose content may have changed.
 *                      If an article's ID appears here, its stored hashes are compared against the fresh values.
 *                      If an article's ID is NOT in this array, its stored hashes are assumed current.
 * @returns CacheCheckResult with cached and needsGeneration arrays
 */
export function checkEmbeddingCache(
  articles: ArticleEmbeddingState[],
  currentModel: string,
  freshHashes?: FreshHash[]
): CacheCheckResult {
  // Build a lookup map for fresh hashes
  const freshHashMap = new Map<string, FreshHash>();
  if (freshHashes) {
    for (const fh of freshHashes) {
      freshHashMap.set(fh.articleId, fh);
    }
  }

  const cached: ArticleEmbeddingState[] = [];
  const needsGeneration: ArticleEmbeddingState[] = [];

  for (const article of articles) {
    if (isCached(article, currentModel, freshHashMap)) {
      cached.push(article);
    } else {
      needsGeneration.push(article);
    }
  }

  return { cached, needsGeneration };
}

/**
 * Determine if a single article's embedding is still valid.
 */
function isCached(
  article: ArticleEmbeddingState,
  currentModel: string,
  freshHashMap: Map<string, FreshHash>
): boolean {
  // Condition 1: embedding must exist
  if (article.embedding === null) {
    return false;
  }

  // Condition 2: model must match current provider
  if (article.embeddingModel !== currentModel) {
    return false;
  }

  // Condition 3 & 4: hashes must match
  const freshHash = freshHashMap.get(article.id);
  if (freshHash) {
    // Fresh hashes provided — compare stored article hashes against fresh values
    if (article.bodyHash !== freshHash.bodyHash) {
      return false;
    }
    if (article.titleHash !== freshHash.titleHash) {
      return false;
    }
  }
  // If no fresh hash provided for this article, stored hashes are assumed current

  return true;
}
```

**Verify GREEN:**

```bash
npx vitest tests/lib/embeddings/cache.test.ts --run 2>&1 | tail -10
# Expected: 6 passing tests
```

**Commit the GREEN implementation:**

```bash
git add src/lib/embeddings/cache.ts
git commit -m "feat(embeddings): GREEN — implement cache check logic

checkEmbeddingCache() splits articles into cached vs. needsGeneration
based on embedding presence, model match, and bodyHash/titleHash comparison.
Supports optional freshHashes for detecting content changes. All 6 tests pass."
```

---

## TDD Agent: Task 4.6 — Batch Processor (RED/GREEN)

> **Branch:** `feature/phase-4-tdd` (continues from 4.5)
> **Depends on:** Task 4.5 (cache.ts), types from 4.1 (used via local interface stub until merge)

### Step 4.6.1 — RED: Write 3 failing OpenAI provider tests

- [ ] Create `tests/lib/embeddings/providers/openai.test.ts`

**File:** `tests/lib/embeddings/providers/openai.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * OpenAI embedding provider tests.
 *
 * These tests mock the OpenAI SDK to verify:
 * 1. Correct embedding dimensions in response
 * 2. Batch input handling (multiple texts in one call)
 * 3. Error propagation from API failures
 */

// Mock the openai module before importing the provider
vi.mock("openai", () => {
  const mockCreate = vi.fn();

  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: mockCreate,
      },
    })),
    __mockCreate: mockCreate,
  };
});

// Import after mock setup
import { OpenAIEmbeddingProvider } from "@/lib/embeddings/providers/openai";
import OpenAI from "openai";

// Access the mock function for assertions
const getMockCreate = () => {
  const instance = new OpenAI({ apiKey: "test-key" });
  return instance.embeddings.create as ReturnType<typeof vi.fn>;
};

describe("OpenAIEmbeddingProvider", () => {
  let provider: OpenAIEmbeddingProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIEmbeddingProvider("test-api-key");
    mockCreate = getMockCreate();
  });

  it("returns_embeddings_with_correct_dimensions", async () => {
    const fakeEmbedding = Array(1536).fill(0.01);

    mockCreate.mockResolvedValueOnce({
      data: [{ index: 0, embedding: fakeEmbedding }],
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });

    const result = await provider.embed(["Hello world"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1536);
    expect(result[0]).toEqual(fakeEmbedding);
  });

  it("handles_batch_input", async () => {
    const fakeEmbedding1 = Array(1536).fill(0.01);
    const fakeEmbedding2 = Array(1536).fill(0.02);
    const fakeEmbedding3 = Array(1536).fill(0.03);

    mockCreate.mockResolvedValueOnce({
      data: [
        // Return out of order to verify sorting by index
        { index: 2, embedding: fakeEmbedding3 },
        { index: 0, embedding: fakeEmbedding1 },
        { index: 1, embedding: fakeEmbedding2 },
      ],
      usage: { prompt_tokens: 30, total_tokens: 30 },
    });

    const result = await provider.embed([
      "First text",
      "Second text",
      "Third text",
    ]);

    expect(result).toHaveLength(3);
    // Verify order matches input order (sorted by index)
    expect(result[0]).toEqual(fakeEmbedding1);
    expect(result[1]).toEqual(fakeEmbedding2);
    expect(result[2]).toEqual(fakeEmbedding3);
  });

  it("throws_on_api_error", async () => {
    mockCreate.mockRejectedValueOnce(
      new Error("Rate limit exceeded")
    );

    await expect(provider.embed(["test"])).rejects.toThrow(
      "Rate limit exceeded"
    );
  });
});
```

**Commit the RED tests:**

```bash
git add tests/lib/embeddings/providers/openai.test.ts
git commit -m "test(embeddings): RED — add 3 failing OpenAI provider tests

Tests for OpenAIEmbeddingProvider: correct dimensions, batch input with
out-of-order index sorting, and API error propagation. Mocks openai SDK."
```

**Verify RED (will fail until Provider Agent's code is merged, or pass if openai.ts already exists):**

```bash
npx vitest tests/lib/embeddings/providers/openai.test.ts --run 2>&1 | tail -10
# Expected: failing (module not found) until merge with Provider Agent
```

### Step 4.6.2 — Write the batch processor implementation

- [ ] Create `src/lib/embeddings/batch.ts`

**File:** `src/lib/embeddings/batch.ts`

```typescript
import type { EmbeddingProvider, ArticleEmbeddingState } from "./types";
import { STORAGE_DIMENSIONS } from "./providers";
import { prisma } from "../db";

/**
 * Batch embedding processor.
 *
 * Takes articles that need embedding generation, calls the provider in chunks,
 * zero-pads shorter vectors to STORAGE_DIMENSIONS (1536), and persists results
 * to the database via raw SQL.
 *
 * [AAP-B6] Zero-padding: Cohere produces 1024-dim vectors. The pgvector column
 * is vector(1536). Shorter vectors are padded with zeros to fill the remaining
 * dimensions. This ensures all vectors in the same project have uniform length
 * and the HNSW index operates correctly.
 */

/** Default chunk size for OpenAI (2048). Overridable for testing. */
const DEFAULT_CHUNK_SIZE = 2048;

/**
 * Generate embeddings for a batch of articles and persist them to the database.
 *
 * @param articles - Articles needing fresh embeddings (from checkEmbeddingCache)
 * @param provider - The embedding provider to use
 * @param chunkSize - Max texts per API call (defaults to 2048 for OpenAI)
 * @returns Map of articleId -> embedding vector (after zero-padding)
 */
export async function generateEmbeddings(
  articles: ArticleEmbeddingState[],
  provider: EmbeddingProvider,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<Map<string, number[]>> {
  if (articles.length === 0) {
    return new Map();
  }

  const resultMap = new Map<string, number[]>();

  // Prepare texts: concatenate title + body for richer embeddings
  const texts = articles.map((a) => `${a.title}\n\n${a.body}`);

  // Process in chunks
  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunkTexts = texts.slice(i, i + chunkSize);
    const chunkArticles = articles.slice(i, i + chunkSize);

    // Call the provider
    const embeddings = await provider.embed(chunkTexts);

    // Zero-pad if needed and collect results
    for (let j = 0; j < chunkArticles.length; j++) {
      const article = chunkArticles[j];
      const embedding = zeroPad(embeddings[j], STORAGE_DIMENSIONS);
      resultMap.set(article.id, embedding);
    }
  }

  // Persist all embeddings to the database in a transaction
  await persistEmbeddings(resultMap, provider.modelId);

  return resultMap;
}

/**
 * Zero-pad a vector to the target length.
 *
 * If the vector is already the target length, returns it unchanged.
 * If shorter, appends zeros. If longer, throws (should never happen
 * with known providers).
 *
 * @param vector - The embedding vector to pad
 * @param targetLength - The desired length (STORAGE_DIMENSIONS = 1536)
 * @returns The padded vector
 */
export function zeroPad(vector: number[], targetLength: number): number[] {
  if (vector.length === targetLength) {
    return vector;
  }

  if (vector.length > targetLength) {
    throw new Error(
      `Vector length ${vector.length} exceeds target ${targetLength}. ` +
      `This should not happen — check provider dimensions configuration.`
    );
  }

  // Pad with zeros
  const padded = new Array(targetLength).fill(0);
  for (let i = 0; i < vector.length; i++) {
    padded[i] = vector[i];
  }
  return padded;
}

/**
 * Persist embeddings to Article records via raw SQL.
 *
 * Uses individual UPDATE statements within a transaction for reliability.
 * The pgvector column accepts a text representation of the vector: '[0.1, 0.2, ...]'.
 *
 * @param embeddings - Map of articleId -> embedding vector
 * @param modelId - The model ID to store on the article (e.g. "openai/text-embedding-3-small")
 */
async function persistEmbeddings(
  embeddings: Map<string, number[]>,
  modelId: string
): Promise<void> {
  if (embeddings.size === 0) return;

  await prisma.$transaction(
    Array.from(embeddings.entries()).map(([articleId, vector]) => {
      // Convert vector to pgvector text format: '[0.1,0.2,...,0.0]'
      const vectorStr = `[${vector.join(",")}]`;

      return prisma.$executeRaw`
        UPDATE "Article"
        SET "embedding" = ${vectorStr}::vector,
            "embeddingModel" = ${modelId},
            "updatedAt" = NOW()
        WHERE "id" = ${articleId}
      `;
    })
  );
}
```

**Verify:**

```bash
npx tsc --noEmit src/lib/embeddings/batch.ts 2>&1 | head -5
# Expected: no errors
```

**Commit the batch processor:**

```bash
git add src/lib/embeddings/batch.ts
git commit -m "feat(embeddings): GREEN — add batch processor with zero-padding [AAP-B6]

generateEmbeddings() processes articles in chunks, calls provider.embed(),
zero-pads shorter vectors to 1536 dims, and persists via raw SQL transaction.
zeroPad() exported for testing. OpenAI provider tests should now pass."
```

---

## TDD Agent: Task 4.7 — Vector Similarity Queries

> **Branch:** `feature/phase-4-tdd` (continues from 4.6)
> **Depends on:** Phase 1 (pgvector HNSW index on Article table)

### Step 4.7.1 — Write the similarity query module

- [ ] Create `src/lib/embeddings/similarity.ts`

**File:** `src/lib/embeddings/similarity.ts`

```typescript
import { prisma } from "../db";
import type { SimilarArticle } from "./types";

/**
 * Vector similarity queries using pgvector.
 *
 * Uses the cosine distance operator `<=>` with the HNSW index on Article.embedding.
 * Sets hnsw.ef_search = 100 per DBA recommendation for analysis sessions
 * (higher recall at slight latency cost — acceptable for batch analysis).
 *
 * The HNSW index was created in Phase 1 migration:
 *   CREATE INDEX "Article_embedding_hnsw_idx"
 *     ON "Article" USING hnsw ("embedding" vector_cosine_ops)
 *     WITH (m = 16, ef_construction = 64);
 */

/**
 * Find articles most similar to a given embedding vector within a project.
 *
 * @param embedding - The query embedding vector (must be 1536 dimensions)
 * @param projectId - Scope results to this project
 * @param excludeArticleId - Exclude this article from results (typically the source article)
 * @param limit - Maximum number of results to return (default: 10)
 * @returns Array of similar articles sorted by cosine distance (ascending = most similar first)
 */
export async function findSimilarArticles(
  embedding: number[],
  projectId: string,
  excludeArticleId: string,
  limit: number = 10
): Promise<SimilarArticle[]> {
  // Convert embedding to pgvector text format
  const vectorStr = `[${embedding.join(",")}]`;

  // Set ef_search for this session (higher = better recall, slightly slower)
  await prisma.$executeRaw`SET LOCAL hnsw.ef_search = 100`;

  // Query using cosine distance operator <=>
  const results = await prisma.$queryRaw<SimilarArticle[]>`
    SELECT
      a."id",
      a."title",
      a."url",
      (a."embedding" <=> ${vectorStr}::vector) AS "distance"
    FROM "Article" a
    WHERE a."projectId" = ${projectId}
      AND a."id" != ${excludeArticleId}
      AND a."embedding" IS NOT NULL
    ORDER BY a."embedding" <=> ${vectorStr}::vector ASC
    LIMIT ${limit}
  `;

  return results;
}

/**
 * Find articles similar to a specific article (by article ID).
 *
 * Convenience wrapper that fetches the source article's embedding first,
 * then delegates to findSimilarArticles.
 *
 * @param articleId - The source article to find similar articles for
 * @param projectId - Scope results to this project
 * @param limit - Maximum number of results
 * @returns Array of similar articles, or empty array if source has no embedding
 */
export async function findSimilarToArticle(
  articleId: string,
  projectId: string,
  limit: number = 10
): Promise<SimilarArticle[]> {
  // Fetch the source article's embedding via raw SQL (Prisma doesn't model vector columns)
  const sourceRows = await prisma.$queryRaw<Array<{ embedding: string }>>`
    SELECT "embedding"::text
    FROM "Article"
    WHERE "id" = ${articleId}
      AND "embedding" IS NOT NULL
  `;

  if (sourceRows.length === 0) {
    return [];
  }

  // Parse the pgvector text representation back to number[]
  const embeddingStr = sourceRows[0].embedding;
  const embedding = parseVectorString(embeddingStr);

  return findSimilarArticles(embedding, projectId, articleId, limit);
}

/**
 * Parse a pgvector text representation into a number array.
 * pgvector returns vectors as "[0.1,0.2,...,0.3]"
 */
function parseVectorString(vectorStr: string): number[] {
  // Remove brackets and split by comma
  const cleaned = vectorStr.replace(/^\[|\]$/g, "");
  return cleaned.split(",").map(Number);
}
```

**Verify:**

```bash
npx tsc --noEmit src/lib/embeddings/similarity.ts 2>&1 | head -5
# Expected: no errors
```

**Commit the similarity module:**

```bash
git add src/lib/embeddings/similarity.ts
git commit -m "feat(embeddings): add pgvector similarity queries with ef_search=100

findSimilarArticles() uses cosine distance operator <=>, scoped by project,
with hnsw.ef_search=100 per DBA recommendation. findSimilarToArticle() is
a convenience wrapper that fetches source embedding first. Parses pgvector
text format back to number[]."
```

**Expected:** Clean commit. TDD Agent work is complete.

---

## Integration Verification

> After both branches merge into `feature/phase-4`, run these checks.

### Merge Sequence

```bash
# 1. Create integration branch
git checkout develop
git checkout -b feature/phase-4

# 2. Merge Provider Agent first (canonical types)
git merge feature/phase-4-provider --no-ff -m "chore(phase-4): merge provider agent branch"

# 3. Merge TDD Agent second (depends on types)
git merge feature/phase-4-tdd --no-ff -m "chore(phase-4): merge tdd agent branch"

# 4. Resolve any import path issues if needed
```

### Automated Checks

- [ ] TypeScript compilation passes

```bash
npx tsc --noEmit
# Expected: exit 0
```

- [ ] Cache tests pass (6/6)

```bash
npx vitest tests/lib/embeddings/cache.test.ts --run
# Expected: 6 tests passing
```

- [ ] OpenAI provider tests pass (3/3)

```bash
npx vitest tests/lib/embeddings/providers/openai.test.ts --run
# Expected: 3 tests passing
```

- [ ] All tests pass (including prior phases)

```bash
npx vitest --run
# Expected: all passing
```

- [ ] Build succeeds

```bash
npm run build
# Expected: exit 0
```

### Manual Verification Checklist

- [ ] `src/lib/embeddings/types.ts` exports `EmbeddingProvider` with `modelId`, `dimensions`, `embed`
- [ ] `src/lib/embeddings/providers/openai.ts` uses `text-embedding-3-small`, 1536 dims, chunks at 2048
- [ ] `src/lib/embeddings/providers/cohere.ts` uses `embed-english-v3.0`, 1024 dims, chunks at 96
- [ ] `src/lib/embeddings/index.ts` `getProvider()` defaults to OpenAI, supports "cohere"
- [ ] `src/lib/embeddings/index.ts` `clearProjectEmbeddings()` nullifies embeddings atomically [AAP-B6]
- [ ] `src/lib/embeddings/providers.ts` has `PROVIDER_DIMENSIONS` map and `STORAGE_DIMENSIONS = 1536`
- [ ] `src/lib/embeddings/cache.ts` uses bodyHash + titleHash + embeddingModel + embedding presence
- [ ] `src/lib/embeddings/batch.ts` `zeroPad()` pads shorter vectors to 1536 [AAP-B6]
- [ ] `src/lib/embeddings/batch.ts` persists via `prisma.$transaction` with raw SQL
- [ ] `src/lib/embeddings/similarity.ts` uses `<=>` operator with `SET LOCAL hnsw.ef_search = 100`

### Acceptance Criteria (from Implementation Plan)

- [ ] OpenAI provider generates embeddings for test articles
- [ ] Cache check correctly identifies cached vs. needing-generation articles
- [ ] Embeddings are persisted to Article records via raw SQL
- [ ] `findSimilarArticles` returns ranked results using pgvector cosine distance
- [ ] `embeddingModel` is stored on Article records
- [ ] Provider switch causes cache miss (different model ID)
- [ ] [AAP-B6] Provider switch clears all embeddings atomically
- [ ] [AAP-B6] Cohere vectors are zero-padded to 1536 dimensions before storage

---

## File Summary

### Provider Agent files (feature/phase-4-provider)

| File | Task | Description |
|------|------|-------------|
| `src/lib/embeddings/types.ts` | 4.1 | EmbeddingProvider interface, CacheCheckResult, ArticleEmbeddingState, SimilarArticle |
| `src/lib/embeddings/providers/openai.ts` | 4.2 | OpenAI text-embedding-3-small, 1536 dims, batch 2048 |
| `src/lib/embeddings/providers/cohere.ts` | 4.3 | Cohere embed-english-v3.0, 1024 dims, batch 96 |
| `src/lib/embeddings/providers.ts` | 4.4 | PROVIDER_DIMENSIONS map, STORAGE_DIMENSIONS constant |
| `src/lib/embeddings/index.ts` | 4.4 | getProvider() factory, clearProjectEmbeddings() [AAP-B6] |

### TDD Agent files (feature/phase-4-tdd)

| File | Task | Description |
|------|------|-------------|
| `tests/lib/embeddings/cache.test.ts` | 4.5 | 6 cache check tests (RED then GREEN) |
| `src/lib/embeddings/cache.ts` | 4.5 | checkEmbeddingCache() implementation |
| `tests/lib/embeddings/providers/openai.test.ts` | 4.6 | 3 OpenAI provider tests (RED then GREEN) |
| `src/lib/embeddings/batch.ts` | 4.6 | generateEmbeddings(), zeroPad(), persistEmbeddings() |
| `src/lib/embeddings/similarity.ts` | 4.7 | findSimilarArticles(), findSimilarToArticle() |

### Test count: 9 total (6 cache + 3 OpenAI)
