# Phase 4: Embedding Provider & Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the embedding provider abstraction (OpenAI + Cohere), cache-check logic, batch processor with zero-padding, pgvector similarity queries, and atomic provider switching.

**Architecture:** Provider-agnostic abstraction layer where all embedding providers implement `EmbeddingProvider` interface. Cache check uses bodyHash + titleHash + embeddingModel for invalidation. All vectors are stored at fixed 1536 dimensions (shorter vectors zero-padded). Provider config is per-project via `StrategyConfig` table with env var fallback.

**Tech Stack:** OpenAI SDK (`openai ^6.32.0`), direct `fetch` for Cohere, pgvector for storage/similarity, Prisma `$queryRaw`/`$executeRaw` for vector operations, Vitest for testing.

**Spec:** `docs/superpowers/specs/2026-03-23-phase4-embedding-provider-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|---|---|
| `src/lib/embeddings/types.ts` | EmbeddingProvider interface, CacheCheckResult, SimilarArticle, ArticleWithEmbedding |
| `src/lib/embeddings/providers.ts` | PROVIDER_DIMENSIONS map, STORAGE_DIMENSIONS constant |
| `src/lib/embeddings/providers/openai.ts` | OpenAI adapter (SDK-based, 1536 dims, batch 2048) |
| `src/lib/embeddings/providers/cohere.ts` | Cohere adapter (direct fetch, 1024 dims, batch 96) |
| `src/lib/embeddings/index.ts` | `getProvider()` factory — reads StrategyConfig, env fallback |
| `src/lib/embeddings/cache.ts` | `checkEmbeddingCache()` pure function |
| `src/lib/embeddings/batch.ts` | `processEmbeddings()` orchestrator with zero-padding |
| `src/lib/embeddings/similarity.ts` | `findSimilarArticles()` pgvector cosine queries |
| `src/lib/embeddings/switch.ts` | `switchProvider()` atomic provider change [AAP-B6] |
| `tests/lib/embeddings/cache.test.ts` | Cache check tests (6) |
| `tests/lib/embeddings/providers/openai.test.ts` | OpenAI adapter tests (3) |
| `tests/lib/embeddings/providers/cohere.test.ts` | Cohere adapter tests (3) |
| `tests/lib/embeddings/batch.test.ts` | Batch processor tests (6) |
| `tests/lib/embeddings/similarity.test.ts` | Similarity query tests (4) |
| `tests/lib/embeddings/switch.test.ts` | Provider switching tests (2) |

### Files to modify

| File | Change |
|---|---|
| `src/app/api/cron/crawl/route.ts` | Add embedding invalidation (raw SQL) after article upsert |
| `src/app/api/articles/route.ts` | Same — sync path upsert |
| `src/app/api/articles/upload/route.ts` | Same — upsertArticle helper |
| `src/app/api/articles/push/route.ts` | Same — update block |

---

## Task 1: Types & Provider Dimensions

**Files:**
- Create: `src/lib/embeddings/types.ts`
- Create: `src/lib/embeddings/providers.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * Core types for the embedding provider abstraction layer.
 */

/** Contract that all embedding providers implement. */
export interface EmbeddingProvider {
  /** Unique model identifier, e.g. "openai/text-embedding-3-small" */
  modelId: string;
  /** Native output dimensions (1536 for OpenAI, 1024 for Cohere) */
  dimensions: number;
  /** Max texts per API call (2048 for OpenAI, 96 for Cohere) */
  batchSize: number;
  /** Generate embeddings for one or more texts. Returns vectors in input order. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Article fields needed for embedding operations (subset of Prisma Article). */
export interface ArticleWithEmbedding {
  id: string;
  title: string;
  body: string;
  bodyHash: string;
  titleHash: string;
  embeddingModel: string | null;
  /** True if the embedding column is not null. We can't type the vector directly. */
  hasEmbedding: boolean;
}

/** Result of classifying articles into cached vs needs-generation. */
export interface CacheCheckResult {
  cached: ArticleWithEmbedding[];
  needsGeneration: ArticleWithEmbedding[];
}

/** A similar article returned from a pgvector cosine distance query. */
export interface SimilarArticle {
  id: string;
  url: string;
  title: string;
  similarity: number;
}
```

- [ ] **Step 2: Create the provider dimensions file**

```typescript
/**
 * Static provider dimension mapping.
 * Used by zero-padding logic and provider switching validation.
 */

export const PROVIDER_DIMENSIONS: Record<string, number> = {
  "openai/text-embedding-3-small": 1536,
  "cohere/embed-english-v3.0": 1024,
};

/** All vectors are stored at this fixed dimension in pgvector. */
export const STORAGE_DIMENSIONS = 1536;

/** Validate that a model ID is a known provider. */
export function isValidProvider(modelId: string): boolean {
  return modelId in PROVIDER_DIMENSIONS;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/embeddings/types.ts src/lib/embeddings/providers.ts
git commit -m "feat(embeddings): add shared types and provider dimensions"
```

---

## Task 2: OpenAI Adapter (TDD)

**Files:**
- Create: `tests/lib/embeddings/providers/openai.test.ts`
- Create: `src/lib/embeddings/providers/openai.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist a single shared mock function so every `new OpenAI()` call
// (including inside the provider constructor) shares the same reference
const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: { create: mockCreate },
  })),
}));

import { OpenAIEmbeddingProvider } from "@/lib/embeddings/providers/openai";

describe("OpenAIEmbeddingProvider", () => {
  let provider: OpenAIEmbeddingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIEmbeddingProvider();
  });

  it("returns_embeddings_with_correct_dimensions", async () => {
    const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    mockCreate.mockResolvedValue({
      data: [{ embedding: fakeEmbedding, index: 0 }],
    });

    const result = await provider.embed(["test text"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1536);
    expect(provider.modelId).toBe("openai/text-embedding-3-small");
    expect(provider.dimensions).toBe(1536);
    expect(provider.batchSize).toBe(2048);
  });

  it("handles_batch_input", async () => {
    const fakeEmbedding = Array.from({ length: 1536 }, () => 0.1);
    mockCreate.mockResolvedValue({
      data: [
        { embedding: fakeEmbedding, index: 0 },
        { embedding: fakeEmbedding, index: 1 },
        { embedding: fakeEmbedding, index: 2 },
      ],
    });

    const result = await provider.embed(["text1", "text2", "text3"]);
    expect(result).toHaveLength(3);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: ["text1", "text2", "text3"],
        model: "text-embedding-3-small",
      })
    );
  });

  it("throws_on_api_error", async () => {
    mockCreate.mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(provider.embed(["test"])).rejects.toThrow("API rate limit exceeded");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/embeddings/providers/openai.test.ts --run`

Expected: FAIL — `OpenAIEmbeddingProvider` not defined.

- [ ] **Step 3: Implement the OpenAI adapter**

```typescript
import OpenAI from "openai";
import type { EmbeddingProvider } from "../types";

/**
 * OpenAI embedding provider using text-embedding-3-small.
 * Auth: reads OPENAI_API_KEY from environment automatically.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "openai/text-embedding-3-small";
  readonly dimensions = 1536;
  readonly batchSize = 2048;

  private client: OpenAI;

  constructor() {
    this.client = new OpenAI();
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      input: texts,
      model: "text-embedding-3-small",
    });

    // Sort by index to ensure output order matches input order
    const sorted = response.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/embeddings/providers/openai.test.ts --run`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings/providers/openai.ts tests/lib/embeddings/providers/openai.test.ts
git commit -m "feat(embeddings): add OpenAI adapter with TDD [text-embedding-3-small]"
```

---

## Task 3: Cohere Adapter (TDD)

**Files:**
- Create: `tests/lib/embeddings/providers/cohere.test.ts`
- Create: `src/lib/embeddings/providers/cohere.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CohereEmbeddingProvider } from "@/lib/embeddings/providers/cohere";

describe("CohereEmbeddingProvider", () => {
  let provider: CohereEmbeddingProvider;

  beforeEach(() => {
    vi.stubEnv("COHERE_API_KEY", "test-cohere-key");
    provider = new CohereEmbeddingProvider();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns_embeddings_with_correct_dimensions", async () => {
    const fakeEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          embeddings: { float: [fakeEmbedding] },
        }),
        { status: 200 }
      )
    );

    const result = await provider.embed(["test text"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1024);
    expect(provider.modelId).toBe("cohere/embed-english-v3.0");
    expect(provider.dimensions).toBe(1024);
    expect(provider.batchSize).toBe(96);
  });

  it("sends_correct_auth_header_and_model", async () => {
    const fakeEmbedding = Array.from({ length: 1024 }, () => 0.1);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ embeddings: { float: [fakeEmbedding] } }),
        { status: 200 }
      )
    );
    global.fetch = fetchMock;

    await provider.embed(["test text"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cohere.ai/v2/embed",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-cohere-key",
          "Content-Type": "application/json",
        }),
      })
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("embed-english-v3.0");
    expect(body.texts).toEqual(["test text"]);
    expect(body.input_type).toBe("search_document");
  });

  it("throws_on_api_error", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid API key" }), {
        status: 401,
      })
    );

    await expect(provider.embed(["test"])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/embeddings/providers/cohere.test.ts --run`

Expected: FAIL — `CohereEmbeddingProvider` not defined.

- [ ] **Step 3: Implement the Cohere adapter**

```typescript
import type { EmbeddingProvider } from "../types";

const COHERE_API_URL = "https://api.cohere.ai/v2/embed";

/**
 * Cohere embedding provider using embed-english-v3.0.
 * Uses direct fetch — no SDK dependency.
 * Auth: reads COHERE_API_KEY from environment.
 */
export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "cohere/embed-english-v3.0";
  readonly dimensions = 1024;
  readonly batchSize = 96;

  async embed(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      throw new Error("COHERE_API_KEY environment variable is required");
    }

    const response = await fetch(COHERE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "embed-english-v3.0",
        texts,
        input_type: "search_document",
        embedding_types: ["float"],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Cohere API error (${response.status}): ${error}`
      );
    }

    const data = await response.json();
    return data.embeddings.float;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/embeddings/providers/cohere.test.ts --run`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings/providers/cohere.ts tests/lib/embeddings/providers/cohere.test.ts
git commit -m "feat(embeddings): add Cohere adapter with TDD [embed-english-v3.0, direct fetch]"
```

---

## Task 4: Provider Factory

**Files:**
- Create: `src/lib/embeddings/index.ts`

- [ ] **Step 1: Implement the factory**

```typescript
import { prisma } from "@/lib/db";
import { isValidProvider, PROVIDER_DIMENSIONS } from "./providers";
import { OpenAIEmbeddingProvider } from "./providers/openai";
import { CohereEmbeddingProvider } from "./providers/cohere";
import type { EmbeddingProvider } from "./types";

const DEFAULT_PROVIDER = "openai/text-embedding-3-small";

/**
 * Get the configured embedding provider for a project.
 *
 * Resolution order:
 * 1. StrategyConfig table (projectId + strategyId: "embedding")
 * 2. EMBEDDING_PROVIDER environment variable
 * 3. Default: openai/text-embedding-3-small
 */
export async function getProvider(
  projectId: string
): Promise<EmbeddingProvider> {
  // Check project-specific config
  const config = await prisma.strategyConfig.findUnique({
    where: {
      projectId_strategyId: { projectId, strategyId: "embedding" },
    },
  });

  const modelId =
    (config?.settings as { provider?: string })?.provider ??
    process.env.EMBEDDING_PROVIDER ??
    DEFAULT_PROVIDER;

  if (!isValidProvider(modelId)) {
    throw new Error(
      `Unknown embedding provider: "${modelId}". Valid providers: ${Object.keys(PROVIDER_DIMENSIONS).join(", ")}`
    );
  }

  return createProvider(modelId);
}

function createProvider(modelId: string): EmbeddingProvider {
  switch (modelId) {
    case "openai/text-embedding-3-small":
      return new OpenAIEmbeddingProvider();
    case "cohere/embed-english-v3.0":
      return new CohereEmbeddingProvider();
    default:
      throw new Error(`No adapter for provider: ${modelId}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/embeddings/index.ts
git commit -m "feat(embeddings): add provider factory with StrategyConfig + env fallback"
```

---

## Task 5: Cache Check (TDD)

**Files:**
- Create: `tests/lib/embeddings/cache.test.ts`
- Create: `src/lib/embeddings/cache.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { checkEmbeddingCache } from "@/lib/embeddings/cache";
import type { ArticleWithEmbedding } from "@/lib/embeddings/types";

const makeArticle = (
  overrides?: Partial<ArticleWithEmbedding>
): ArticleWithEmbedding => ({
  id: "art-1",
  title: "Test Title",
  body: "Test body content",
  bodyHash: "abc123",
  titleHash: "def456",
  embeddingModel: "openai/text-embedding-3-small",
  hasEmbedding: true,
  ...overrides,
});

const MODEL = "openai/text-embedding-3-small";

describe("checkEmbeddingCache", () => {
  it("returns_cached_when_all_conditions_match", () => {
    const article = makeArticle();
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "def456" }]]);

    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.cached).toHaveLength(1);
    expect(result.needsGeneration).toHaveLength(0);
  });

  it("returns_needs_generation_when_body_hash_changed", () => {
    const article = makeArticle();
    const hashes = new Map([["art-1", { bodyHash: "DIFFERENT", titleHash: "def456" }]]);

    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.cached).toHaveLength(0);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("returns_needs_generation_when_title_hash_changed", () => {
    const article = makeArticle();
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "DIFFERENT" }]]);

    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("returns_needs_generation_when_model_changed", () => {
    const article = makeArticle({ embeddingModel: "cohere/embed-english-v3.0" });
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "def456" }]]);

    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("returns_needs_generation_when_no_embedding", () => {
    const article = makeArticle({ hasEmbedding: false, embeddingModel: null });
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "def456" }]]);

    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("splits_mixed_batch_correctly", () => {
    const cached = makeArticle({ id: "art-1" });
    const needsGen = makeArticle({
      id: "art-2",
      hasEmbedding: false,
      embeddingModel: null,
    });
    const hashes = new Map([
      ["art-1", { bodyHash: "abc123", titleHash: "def456" }],
      ["art-2", { bodyHash: "abc123", titleHash: "def456" }],
    ]);

    const result = checkEmbeddingCache([cached, needsGen], MODEL, hashes);
    expect(result.cached).toHaveLength(1);
    expect(result.cached[0].id).toBe("art-1");
    expect(result.needsGeneration).toHaveLength(1);
    expect(result.needsGeneration[0].id).toBe("art-2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/embeddings/cache.test.ts --run`

Expected: FAIL — `checkEmbeddingCache` not defined.

- [ ] **Step 3: Implement the cache check**

```typescript
import type { ArticleWithEmbedding, CacheCheckResult } from "./types";

/**
 * Pure function: classifies articles into cached vs needs-generation.
 *
 * An article's embedding is cached when ALL conditions are true:
 * 1. embeddingModel matches the current provider
 * 2. embedding exists (hasEmbedding is true)
 * 3. bodyHash matches current content (defensive, per DECISION-001)
 * 4. titleHash matches current content (defensive, per DECISION-001)
 *
 * No database calls — this is a pure classification function.
 */
export function checkEmbeddingCache(
  articles: ArticleWithEmbedding[],
  currentModelId: string,
  currentHashes: Map<string, { bodyHash: string; titleHash: string }>
): CacheCheckResult {
  const cached: ArticleWithEmbedding[] = [];
  const needsGeneration: ArticleWithEmbedding[] = [];

  for (const article of articles) {
    const hashes = currentHashes.get(article.id);
    const isCached =
      article.hasEmbedding &&
      article.embeddingModel === currentModelId &&
      hashes !== undefined &&
      article.bodyHash === hashes.bodyHash &&
      article.titleHash === hashes.titleHash;

    if (isCached) {
      cached.push(article);
    } else {
      needsGeneration.push(article);
    }
  }

  return { cached, needsGeneration };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/embeddings/cache.test.ts --run`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings/cache.ts tests/lib/embeddings/cache.test.ts
git commit -m "feat(embeddings): add cache check with defensive hash comparison [DECISION-001]"
```

---

## Task 6: Batch Processor (TDD)

**Files:**
- Create: `tests/lib/embeddings/batch.test.ts`
- Create: `src/lib/embeddings/batch.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { processEmbeddings } from "@/lib/embeddings/batch";
import type { ArticleWithEmbedding, EmbeddingProvider } from "@/lib/embeddings/types";

// Mock prisma for raw SQL calls
vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  },
}));

const makeArticle = (
  id: string,
  overrides?: Partial<ArticleWithEmbedding>
): ArticleWithEmbedding => ({
  id,
  title: "Test Title",
  body: "Test body content with enough words",
  bodyHash: "hash1",
  titleHash: "hash2",
  embeddingModel: null,
  hasEmbedding: false,
  ...overrides,
});

const makeProvider = (overrides?: Partial<EmbeddingProvider>): EmbeddingProvider => ({
  modelId: "openai/text-embedding-3-small",
  dimensions: 1536,
  batchSize: 2048,
  embed: vi.fn().mockResolvedValue([
    Array.from({ length: 1536 }, () => 0.1),
  ]),
  ...overrides,
});

describe("processEmbeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips_api_call_for_fully_cached_batch", async () => {
    const article = makeArticle("a1", {
      embeddingModel: "openai/text-embedding-3-small",
      hasEmbedding: true,
    });
    const hashes = new Map([["a1", { bodyHash: "hash1", titleHash: "hash2" }]]);
    const provider = makeProvider();

    const result = await processEmbeddings("proj-1", [article], provider, hashes);
    expect(result.cached).toBe(1);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("zero_pads_shorter_vectors_to_storage_dimensions", async () => {
    const article = makeArticle("a1");
    const hashes = new Map([["a1", { bodyHash: "hash1", titleHash: "hash2" }]]);
    const shortVector = Array.from({ length: 1024 }, () => 0.5);
    const provider = makeProvider({
      modelId: "cohere/embed-english-v3.0",
      dimensions: 1024,
      batchSize: 96,
      embed: vi.fn().mockResolvedValue([shortVector]),
    });

    const { prisma } = await import("@/lib/db");

    await processEmbeddings("proj-1", [article], provider, hashes);

    // Verify the stored vector was padded to 1536
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    const call = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0];
    // The SQL should contain the vector string — parse and check length
    const vectorStr = call[1] as string; // The vector parameter
    const vectorArray = JSON.parse(vectorStr.replace(/^\[/, "[").replace(/\]$/, "]"));
    expect(vectorArray).toHaveLength(1536);
    // First 1024 should be the original values
    expect(vectorArray[0]).toBe(0.5);
    // Padded values should be 0
    expect(vectorArray[1024]).toBe(0);
    expect(vectorArray[1535]).toBe(0);
  });

  it("chunks_large_batches", async () => {
    // Create 5 articles with a provider that has batchSize of 2
    const articles = Array.from({ length: 5 }, (_, i) => makeArticle(`a${i}`));
    const hashes = new Map(articles.map((a) => [a.id, { bodyHash: "hash1", titleHash: "hash2" }]));
    const embedMock = vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => Array.from({ length: 1536 }, () => 0.1)))
    );
    const provider = makeProvider({ batchSize: 2, embed: embedMock });

    await processEmbeddings("proj-1", articles, provider, hashes);

    // 5 articles / batchSize 2 = 3 API calls (2 + 2 + 1)
    expect(embedMock).toHaveBeenCalledTimes(3);
    expect(embedMock.mock.calls[0][0]).toHaveLength(2);
    expect(embedMock.mock.calls[1][0]).toHaveLength(2);
    expect(embedMock.mock.calls[2][0]).toHaveLength(1);
  });

  it("returns_zero_for_empty_article_list", async () => {
    const provider = makeProvider();
    const hashes = new Map();

    const result = await processEmbeddings("proj-1", [], provider, hashes);
    expect(result.cached).toBe(0);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("skips_articles_with_empty_body", async () => {
    const emptyArticle = makeArticle("a1", { title: "", body: "" });
    const normalArticle = makeArticle("a2");
    const hashes = new Map([
      ["a1", { bodyHash: "empty", titleHash: "empty" }],
      ["a2", { bodyHash: "hash1", titleHash: "hash2" }],
    ]);
    const provider = makeProvider();

    const result = await processEmbeddings(
      "proj-1",
      [emptyArticle, normalArticle],
      provider,
      hashes
    );
    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(1);
    // embed should be called once (only for the normal article)
    expect(provider.embed).toHaveBeenCalledTimes(1);
  });

  it("handles_provider_error_mid_batch", async () => {
    const articles = [makeArticle("a1"), makeArticle("a2")];
    const hashes = new Map([
      ["a1", { bodyHash: "hash1", titleHash: "hash2" }],
      ["a2", { bodyHash: "hash1", titleHash: "hash2" }],
    ]);
    const provider = makeProvider({
      embed: vi.fn().mockRejectedValue(new Error("API rate limit")),
    });

    await expect(
      processEmbeddings("proj-1", articles, provider, hashes)
    ).rejects.toThrow("API rate limit");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/embeddings/batch.test.ts --run`

Expected: FAIL — `processEmbeddings` not defined.

- [ ] **Step 3: Implement the batch processor**

```typescript
import { prisma } from "@/lib/db";
import { checkEmbeddingCache } from "./cache";
import { STORAGE_DIMENSIONS } from "./providers";
import type { ArticleWithEmbedding, EmbeddingProvider } from "./types";

/**
 * Orchestrates embedding generation: cache check → batch embed → store.
 *
 * - Skips cached articles (embedding valid for current content + model)
 * - Pre-filters empty/whitespace articles (providers reject empty input)
 * - Chunks into provider.batchSize batches
 * - Zero-pads shorter vectors to STORAGE_DIMENSIONS (1536)
 * - Stores via raw SQL (Prisma can't handle pgvector types)
 */
export async function processEmbeddings(
  projectId: string,
  articles: ArticleWithEmbedding[],
  provider: EmbeddingProvider,
  currentHashes: Map<string, { bodyHash: string; titleHash: string }>
): Promise<{ cached: number; generated: number; skipped: number }> {
  if (articles.length === 0) {
    return { cached: 0, generated: 0, skipped: 0 };
  }

  // Step 1: Cache check
  const { cached, needsGeneration } = checkEmbeddingCache(
    articles,
    provider.modelId,
    currentHashes
  );

  // Step 2: Pre-filter empty content
  const embeddable: ArticleWithEmbedding[] = [];
  let skipped = 0;
  for (const article of needsGeneration) {
    if ((article.title + article.body).trim().length === 0) {
      console.warn(
        `[embeddings] Skipping article ${article.id}: empty title + body`
      );
      skipped++;
    } else {
      embeddable.push(article);
    }
  }

  // Step 3: Process in batches
  let generated = 0;
  for (let i = 0; i < embeddable.length; i += provider.batchSize) {
    const batch = embeddable.slice(i, i + provider.batchSize);
    const texts = batch.map((a) => `${a.title}\n\n${a.body}`);

    const vectors = await provider.embed(texts);

    // Step 4: Zero-pad if needed
    const padded = vectors.map((vec) => zeroPad(vec, STORAGE_DIMENSIONS));

    // Step 5: Store embeddings via raw SQL
    for (let j = 0; j < batch.length; j++) {
      const vectorStr = `[${padded[j].join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "Article" SET "embedding" = $1::vector, "embeddingModel" = $2 WHERE "id" = $3`,
        vectorStr,
        provider.modelId,
        batch[j].id
      );
      generated++;
    }
  }

  return { cached: cached.length, generated, skipped };
}

/**
 * Zero-pad a vector to the target dimensions.
 * If already at or above target, return as-is.
 */
function zeroPad(vector: number[], targetDimensions: number): number[] {
  if (vector.length >= targetDimensions) return vector;
  const padded = new Array(targetDimensions).fill(0);
  for (let i = 0; i < vector.length; i++) {
    padded[i] = vector[i];
  }
  return padded;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/embeddings/batch.test.ts --run`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings/batch.ts tests/lib/embeddings/batch.test.ts
git commit -m "feat(embeddings): add batch processor with zero-padding and empty-body filter [AAP-B6]"
```

---

## Task 7: Similarity Queries (TDD)

**Files:**
- Create: `tests/lib/embeddings/similarity.test.ts`
- Create: `src/lib/embeddings/similarity.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { findSimilarArticles } from "@/lib/embeddings/similarity";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

// Helper: mock the source embedding fetch + transaction-based similarity query
function mockSimilarityQuery(
  prisma: { $queryRaw: ReturnType<typeof vi.fn>; $transaction: ReturnType<typeof vi.fn> },
  sourceEmbedding: string | null,
  similarResults: Array<{ id: string; url: string; title: string; similarity: number }>
) {
  if (sourceEmbedding === null) {
    // No embedding found for source
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
  } else {
    // Source fetch returns embedding
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ embedding: sourceEmbedding }]);
    // Transaction: SET LOCAL + SELECT — mock the transaction to call through and return results
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(0),
        $queryRaw: vi.fn().mockResolvedValue(similarResults),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (fn as any)(tx);
    });
  }
}

describe("findSimilarArticles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns_similar_articles_sorted_by_similarity", async () => {
    const { prisma } = await import("@/lib/db");

    mockSimilarityQuery(prisma as any, "[0.1,0.2,0.3]", [
      { id: "a2", url: "https://example.com/a2", title: "Similar A", similarity: 0.95 },
      { id: "a3", url: "https://example.com/a3", title: "Similar B", similarity: 0.82 },
    ]);

    const results = await findSimilarArticles("proj-1", "a1", 10, 0.5);
    expect(results).toHaveLength(2);
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    expect(results[0].id).toBe("a2");
  });

  it("excludes_source_article_from_results", async () => {
    const { prisma } = await import("@/lib/db");

    mockSimilarityQuery(prisma as any, "[0.1,0.2]", [
      { id: "a2", url: "https://example.com/a2", title: "Other", similarity: 0.9 },
    ]);

    const results = await findSimilarArticles("proj-1", "a1");
    expect(results.every((r) => r.id !== "a1")).toBe(true);
  });

  it("returns_empty_when_source_has_no_embedding", async () => {
    const { prisma } = await import("@/lib/db");

    mockSimilarityQuery(prisma as any, null, []);

    const results = await findSimilarArticles("proj-1", "no-embedding-article");
    expect(results).toHaveLength(0);
  });

  it("respects_threshold_parameter", async () => {
    const { prisma } = await import("@/lib/db");

    mockSimilarityQuery(prisma as any, "[0.1,0.2]", []);

    const results = await findSimilarArticles("proj-1", "a1", 10, 0.95);
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/embeddings/similarity.test.ts --run`

Expected: FAIL — `findSimilarArticles` not defined.

- [ ] **Step 3: Implement similarity queries**

```typescript
import { prisma } from "@/lib/db";
import type { SimilarArticle } from "./types";

/**
 * Find articles similar to a given source article using pgvector cosine distance.
 *
 * Uses raw SQL because Prisma doesn't support pgvector operators.
 * Sets hnsw.ef_search = 100 for better recall quality.
 * Threshold is pushed into the SQL WHERE clause.
 */
export async function findSimilarArticles(
  projectId: string,
  articleId: string,
  limit: number = 10,
  threshold: number = 0.5
): Promise<SimilarArticle[]> {
  // Fetch the source article's embedding
  const sourceRows = await prisma.$queryRaw<{ embedding: string }[]>`
    SELECT embedding::text FROM "Article"
    WHERE id = ${articleId} AND "projectId" = ${projectId} AND embedding IS NOT NULL
  `;

  if (sourceRows.length === 0) {
    return []; // Source article has no embedding
  }

  const sourceEmbedding = sourceRows[0].embedding;

  // Use a transaction so SET LOCAL is scoped correctly.
  // SET LOCAL must be a separate statement — PostgreSQL rejects multiple
  // statements in a single prepared statement (which $queryRaw uses).
  const results = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL hnsw.ef_search = 100`;

    return tx.$queryRaw<SimilarArticle[]>`
      SELECT
        id,
        url,
        title,
        1 - (embedding <=> ${sourceEmbedding}::vector) AS similarity
      FROM "Article"
      WHERE "projectId" = ${projectId}
        AND id != ${articleId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${sourceEmbedding}::vector) >= ${threshold}
      ORDER BY embedding <=> ${sourceEmbedding}::vector
      LIMIT ${limit}
    `;
  });

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/embeddings/similarity.test.ts --run`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings/similarity.ts tests/lib/embeddings/similarity.test.ts
git commit -m "feat(embeddings): add pgvector similarity queries with threshold in SQL"
```

---

## Task 8: Provider Switching (TDD)

**Files:**
- Create: `tests/lib/embeddings/switch.test.ts`
- Create: `src/lib/embeddings/switch.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { switchProvider } from "@/lib/embeddings/switch";

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
}));

describe("switchProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears_all_embeddings_and_updates_config", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(10),
        strategyConfig: {
          upsert: vi.fn().mockResolvedValue({}),
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (fn as any)(tx);
    });
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0); // REINDEX

    await switchProvider("proj-1", "cohere/embed-english-v3.0");

    // Verify transaction was called
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // Verify REINDEX was attempted after transaction
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("rejects_unknown_model_id", async () => {
    await expect(
      switchProvider("proj-1", "unknown/model-xyz")
    ).rejects.toThrow("Unknown embedding provider");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/embeddings/switch.test.ts --run`

Expected: FAIL — `switchProvider` not defined.

- [ ] **Step 3: Implement provider switching**

```typescript
import { prisma } from "@/lib/db";
import { isValidProvider, PROVIDER_DIMENSIONS } from "./providers";

/**
 * Atomically switch the embedding provider for a project [AAP-B6].
 *
 * 1. Validates the new model ID
 * 2. In a transaction: clears all embeddings + updates StrategyConfig
 * 3. After transaction: rebuilds HNSW index (per DECISION-001 JUDGE)
 * 4. Next analysis run will re-embed all articles with the new provider
 */
export async function switchProvider(
  projectId: string,
  newModelId: string
): Promise<void> {
  if (!isValidProvider(newModelId)) {
    throw new Error(
      `Unknown embedding provider: "${newModelId}". Valid: ${Object.keys(PROVIDER_DIMENSIONS).join(", ")}`
    );
  }

  // Step 1: Atomic clear + config update
  await prisma.$transaction(async (tx) => {
    // Clear all embeddings for the project
    await tx.$executeRaw`
      UPDATE "Article"
      SET "embedding" = NULL, "embeddingModel" = NULL
      WHERE "projectId" = ${projectId}
    `;

    // Upsert the provider config
    await tx.strategyConfig.upsert({
      where: {
        projectId_strategyId: { projectId, strategyId: "embedding" },
      },
      create: {
        projectId,
        strategyId: "embedding",
        settings: { provider: newModelId },
      },
      update: {
        settings: { provider: newModelId },
      },
    });
  });

  // Step 2: Rebuild HNSW index (outside transaction — REINDEX CONCURRENTLY can't run in one)
  try {
    await prisma.$executeRaw`
      REINDEX INDEX CONCURRENTLY "Article_embedding_hnsw_idx"
    `;
  } catch (err) {
    console.warn(
      `[embeddings] HNSW index rebuild failed (non-fatal):`,
      err instanceof Error ? err.message : err
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/embeddings/switch.test.ts --run`

Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings/switch.ts tests/lib/embeddings/switch.test.ts
git commit -m "feat(embeddings): add atomic provider switching with HNSW rebuild [AAP-B6]"
```

---

## Task 9: Ingestion Pipeline Embedding Invalidation

**Files:**
- Modify: `src/app/api/cron/crawl/route.ts`
- Modify: `src/app/api/articles/route.ts`
- Modify: `src/app/api/articles/upload/route.ts`
- Modify: `src/app/api/articles/push/route.ts`

- [ ] **Step 1: Read all four files to understand current upsert patterns**

Read each file and locate the article upsert/update blocks. Note:
- `cron/crawl/route.ts` and `articles/route.ts` (sync path): blind upserts — need **unconditional** invalidation
- `articles/upload/route.ts` and `articles/push/route.ts`: hash-comparing updates — need invalidation **in the update path only**

Since the `embedding` column is managed by pgvector raw SQL (not in Prisma schema), invalidation must use `prisma.$executeRaw` as a separate statement after each Prisma upsert/update that modifies content.

- [ ] **Step 2: Add invalidation helper**

Create a small shared helper to avoid code duplication across 4 files. Add to the bottom of `src/lib/embeddings/batch.ts` (it's the module that manages embedding state):

```typescript
/**
 * Invalidate the embedding for an article (set embedding + embeddingModel to NULL).
 * Called by ingestion routes after content changes to ensure cache coherence.
 */
export async function invalidateEmbedding(articleId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Article"
    SET "embedding" = NULL, "embeddingModel" = NULL
    WHERE "id" = ${articleId}
  `;
}
```

- [ ] **Step 3: Add invalidation to cron/crawl/route.ts (unconditional)**

After the `prisma.article.upsert(...)` call in the cron worker's task processing loop, add:

```typescript
import { invalidateEmbedding } from "@/lib/embeddings/batch";

// IMPORTANT: The current code discards the upsert return value.
// Change: `await prisma.article.upsert(...)` → `const upserted = await prisma.article.upsert(...)`
// Then after the upsert:
await invalidateEmbedding(upserted.id);
```

Since this is the blind-upsert path (no hash comparison), always invalidate unconditionally.

- [ ] **Step 4: Add invalidation to articles/route.ts sync path (unconditional)**

Same pattern as Step 3. The current code also discards the upsert return — change to `const upserted = await prisma.article.upsert(...)` and call `await invalidateEmbedding(upserted.id)` after.

- [ ] **Step 5: Add invalidation to articles/upload/route.ts (conditional — update path only)**

In the `upsertArticle` helper, add invalidation only in the `didUpdate` path (when `bodyHash` changed and the article was updated):

```typescript
// After db.article.update():
await invalidateEmbedding(existing.id);
```

Do NOT invalidate on create (new articles have no embedding to clear) or skip (content unchanged).

- [ ] **Step 6: Add invalidation to articles/push/route.ts (conditional — update path only)**

Same as Step 5 — after the `db.article.update()` when content changed.

- [ ] **Step 7: Run full test suite**

Run: `npx vitest --run`

Expected: All tests pass (the invalidation uses raw SQL which is mocked in existing tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/embeddings/batch.ts src/app/api/cron/crawl/route.ts src/app/api/articles/route.ts src/app/api/articles/upload/route.ts src/app/api/articles/push/route.ts
git commit -m "feat(embeddings): add embedding invalidation to all ingestion routes"
```

---

## Task 10: Full Test Suite & Type Check

- [ ] **Step 1: Run all tests**

Run: `npx vitest --run`

Expected: All tests pass including prior phases.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Run linter**

Run: `npm run lint`

Expected: No new lint errors.

- [ ] **Step 4: Fix any issues**

Address failures, re-run checks until clean.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(embeddings): address test/type/lint issues from full suite run"
```

---

## Task 11: Update build_log.md

**Files:**
- Modify: `build_log.md`

- [ ] **Step 1: Append Phase 4 entry**

```markdown
## 2026-03-23 — Phase 4: Embedding Provider & Cache

### Done
- EmbeddingProvider interface with modelId, dimensions, batchSize, embed()
- OpenAI adapter: text-embedding-3-small, 1536 dims, batch 2048 (SDK-based)
- Cohere adapter: embed-english-v3.0, 1024 dims, batch 96 (direct fetch, no SDK)
- Provider factory: StrategyConfig table lookup → env var fallback → default OpenAI
- PROVIDER_DIMENSIONS map + STORAGE_DIMENSIONS constant
- Cache check: defensive bodyHash + titleHash + embeddingModel + embedding presence [DECISION-001]
- Batch processor: cache split, empty-body filter, chunked embedding, zero-padding to 1536 [AAP-B6]
- pgvector similarity: cosine distance with ef_search=100, threshold in SQL WHERE
- Atomic provider switching: clear embeddings + update config + REINDEX CONCURRENTLY [AAP-B6]
- Embedding invalidation in all 4 ingestion routes (cron, articles, upload, push)
- 25 new tests (cache 6, OpenAI 3, Cohere 3, batch 6, similarity 4, switch 2)

### Decisions
- Cohere uses direct fetch (no SDK) — single endpoint doesn't justify a dependency
- Provider config is per-project via StrategyConfig, with EMBEDDING_PROVIDER env fallback
- Cache check includes defensive hash comparison per DECISION-001 (defense in depth)
- Blind-upsert routes use unconditional embedding invalidation; hash-comparing routes invalidate conditionally

### Next
- Phase 5: Crosslink Strategy & Analysis
```

- [ ] **Step 2: Commit**

```bash
git add build_log.md
git commit -m "docs(build-log): add Phase 4 embedding provider & cache entry"
```
