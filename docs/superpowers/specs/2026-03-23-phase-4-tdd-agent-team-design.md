# Phase 4: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Embedding Provider & Cache (Implementation Plan Phase 4, tasks 4.1-4.7)
**Prerequisites:** Phase 1 (schema with pgvector), Phase 3 (articles in database)

---

## Overview

Phase 4 builds the embedding provider abstraction, OpenAI and Cohere integrations, cache-check logic, batch processing, and pgvector similarity queries. This spec defines how two domain-specialized agents execute Phase 4 in parallel using git worktree isolation, with TDD discipline applied to all testable code.

---

## Agent Team

### Provider Agent

**Domain:** Embedding types interface, provider implementations, provider factory, dimension mapping.

**Tasks:** 4.1, 4.2, 4.3, 4.4

**Files created:**

| File | Source Task |
|------|------------|
| `src/lib/embeddings/types.ts` | 4.1 (EmbeddingProvider interface: modelId, dimensions, embed) |
| `src/lib/embeddings/providers/openai.ts` | 4.2 (OpenAI text-embedding-3-small, 1536 dims, batch up to 2048) |
| `src/lib/embeddings/providers/cohere.ts` | 4.3 (Cohere embed-english-v3.0, 1024 dims) |
| `src/lib/embeddings/index.ts` | 4.4 (getProvider factory, default OpenAI, reads from project settings or env) |
| `src/lib/embeddings/providers.ts` | 4.4 (PROVIDER_DIMENSIONS map: openai/text-embedding-3-small -> 1536, cohere/embed-english-v3.0 -> 1024) |

**Notes:**
- [AAP-B6] Provider switching must be atomic: clear all embeddings (`UPDATE "Article" SET embedding = NULL, "embeddingModel" = NULL WHERE "projectId" = ?`), force full re-embed on next analysis run.
- [AAP-B6] Never allow mixed-dimension vectors in the same project. Cohere 1024-dim vectors must be zero-padded to 1536 dimensions before storage, per DECISION-001 JUDGE verdict.
- The `getProvider()` factory must read from project settings or environment variables and default to OpenAI.

**Verification commands:**
- `npx tsc --noEmit` passes with new types
- OpenAI provider instantiates with correct modelId and dimensions
- Cohere provider instantiates with correct modelId and dimensions
- `getProvider()` returns OpenAI by default, Cohere when configured

### TDD Agent

**Domain:** Test-first development of cache check logic, batch processor, and vector similarity queries.

**Tasks:** 4.5, 4.6, 4.7

**Files created (in strict order):**

| Order | File | Source Task | Commit |
|-------|------|------------|--------|
| 1 | `tests/lib/embeddings/cache.test.ts` | 4.5 | RED: 6 failing tests |
| 2 | `src/lib/embeddings/cache.ts` | 4.5 | GREEN: implementation passes all 6 |
| 3 | `tests/lib/embeddings/providers/openai.test.ts` | 4.2 (tests) | RED: 3 failing tests |
| 4 | `src/lib/embeddings/batch.ts` | 4.6 | GREEN: batch processor + OpenAI tests pass |
| 5 | `src/lib/embeddings/similarity.ts` | 4.7 | GREEN: similarity queries |

**Test cases (from Implementation Plan):**

**`tests/lib/embeddings/cache.test.ts`:**
- `it("returns_cached_when_all_hashes_match")`
- `it("returns_needs_generation_when_body_changed")`
- `it("returns_needs_generation_when_title_changed")`
- `it("returns_needs_generation_when_model_changed")`
- `it("returns_needs_generation_when_no_embedding")`
- `it("splits_mixed_batch_correctly")`

**`tests/lib/embeddings/providers/openai.test.ts`:**
- `it("returns_embeddings_with_correct_dimensions")`
- `it("handles_batch_input")`
- `it("throws_on_api_error")`

**Test environment setup:** OpenAI tests must mock the `openai` SDK using `vi.mock('openai')` or MSW interceptors. Cache tests use plain Article objects with varying hash/model/embedding combinations -- no database required.

**TDD discipline:** The agent commits the failing test file before writing any implementation code. The test file is the spec. Two commits minimum per test/implementation pair (red, green).

---

## Execution Flow

```
Phase A ── parallel (worktree isolation, no file overlap)
  Provider Agent ─► feature/phase-4-provider (own worktree)
    Creates: types.ts, providers/openai.ts, providers/cohere.ts, index.ts, providers.ts
  TDD Agent      ─► feature/phase-4-tdd     (own worktree)
    Creates: cache.ts, cache.test.ts, openai.test.ts, batch.ts, similarity.ts

Phase B ── sequential merge into feature/phase-4
  1. Merge feature/phase-4-provider → feature/phase-4
  2. Merge feature/phase-4-tdd     → feature/phase-4
  3. Integration verification pass
  4. PR feature/phase-4 → develop
```

### Merge Order Rationale

Provider Agent first because it creates `types.ts` (the `EmbeddingProvider` interface) that TDD Agent's implementations import. While both agents can develop in parallel (TDD Agent can define a local interface stub or reference the type), Provider Agent's output is the canonical type definition that must land first. TDD Agent second because its files depend on the interface from `types.ts` and the provider implementations.

### Expected Conflicts

- **`src/lib/embeddings/` directory:** No conflict. Provider Agent owns `types.ts`, `index.ts`, `providers.ts`, and `providers/*.ts`. TDD Agent owns `cache.ts`, `batch.ts`, `similarity.ts`. No file overlap.
- **`tests/lib/embeddings/providers/openai.test.ts`:** TDD Agent creates this file. Provider Agent does not create test files. No conflict.
- **Import paths:** TDD Agent's `cache.ts` and `batch.ts` import from `types.ts` (Provider Agent). Both agents must use the same import path `@/lib/embeddings/types`. This is a convention agreement, not a merge conflict.

---

## Integration Verification

After both branches merge into `feature/phase-4`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Types pass | `npx tsc --noEmit` | Exit 0 |
| Cache tests pass | `npx vitest tests/lib/embeddings/cache.test.ts --run` | 6/6 passing |
| OpenAI tests pass | `npx vitest tests/lib/embeddings/providers/openai.test.ts --run` | 3/3 passing |
| All tests pass | `npx vitest --run` | All passing (including prior phases) |
| Build succeeds | `npm run build` | Exit 0 |

### Manual

| Check | Location |
|-------|----------|
| EmbeddingProvider interface exports modelId, dimensions, embed | `src/lib/embeddings/types.ts` |
| OpenAI provider: text-embedding-3-small, 1536 dims, batch support | `src/lib/embeddings/providers/openai.ts` |
| Cohere provider: embed-english-v3.0, 1024 dims | `src/lib/embeddings/providers/cohere.ts` |
| getProvider defaults to OpenAI | `src/lib/embeddings/index.ts` |
| PROVIDER_DIMENSIONS map has both providers | `src/lib/embeddings/providers.ts` |
| Cache check uses bodyHash + titleHash + embeddingModel + embedding presence | `src/lib/embeddings/cache.ts` |
| Batch processor chunks at 2048 per call | `src/lib/embeddings/batch.ts` |
| Similarity uses pgvector `<=>` operator with ef_search=100 | `src/lib/embeddings/similarity.ts` |
| [AAP-B6] Zero-padding logic for shorter vectors | `src/lib/embeddings/batch.ts` |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] OpenAI provider generates embeddings for test articles
- [ ] Cache check correctly identifies cached vs. needing-generation articles
- [ ] Embeddings are persisted to Article records via raw SQL
- [ ] `findSimilarArticles` returns ranked results using pgvector cosine distance
- [ ] `embeddingModel` is stored on Article records
- [ ] Provider switch causes cache miss (different model ID)
- [ ] [AAP-B6] Provider switch clears all embeddings atomically
- [ ] [AAP-B6] Cohere vectors are zero-padded to 1536 dimensions before storage
