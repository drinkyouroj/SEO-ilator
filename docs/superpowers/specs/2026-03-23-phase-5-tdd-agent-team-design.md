# Phase 5: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Crosslink Strategy & Analysis (Implementation Plan Phase 5, tasks 5.1-5.8)
**Prerequisites:** Phase 3 (articles), Phase 4 (embeddings)

---

## Overview

Phase 5 is the heaviest logic phase (25+ testable units). It builds the strategy registry, crosslink strategy with keyword and semantic matching, deduplication and ranking, re-analysis logic, analysis orchestrator, and analysis API routes. This spec defines how four domain-specialized agents execute Phase 5 with a strict dependency ordering, using git worktree isolation and TDD discipline on all testable code.

---

## Agent Team

### Types Agent

**Domain:** Strategy types interface, strategy registry, strategy registration entrypoint.

**Tasks:** 5.1, 5.2, 5.4

**Files created:**

| File | Source Task |
|------|------------|
| `src/lib/strategies/types.ts` | 5.1 (SEOStrategy, ArticleSummary [AAP-B7], AnalysisContext with loadArticleBodies callback, extended Recommendation with targetArticleId/confidence/matchingApproach/sourceContext/charOffsets) |
| `src/lib/strategies/registry.ts` | 5.2 (StrategyRegistry: register, unregister, getStrategy, getAllStrategies, analyzeWithAll; exported singleton `registry`) |
| `src/lib/strategies/index.ts` | 5.4 (imports CrosslinkStrategy + registry, registers crosslink, re-exports registry) |

**Notes:**
- [AAP-B7] `ArticleSummary` is a slimmed-down type without full body text, used in `articleIndex` to prevent OOM on large indexes. Fields: id, url, title, wordCount, existingLinks, hasEmbedding, canonicalUrl, robotsDirectives, language, parseWarning [AAP-O1].
- [AAP-B7] `AnalysisContext` includes `loadArticleBodies: (ids: string[]) => Promise<Map<string, string>>` callback for on-demand body text loading during keyword matching.
- Registry does NOT handle cross-strategy dedup per SEO Expert plan. Each strategy operates independently.
- `src/lib/strategies/index.ts` will initially import from `./crosslink` which does not exist until Crosslink TDD Agent creates it. Types Agent should stub or leave the import commented with a `// TODO: uncomment after crosslink.ts is created` marker.

**Verification commands:**
- `npx tsc --noEmit` passes with new types (may require stub for crosslink import)
- SEOStrategy interface exports all required methods
- StrategyRegistry methods are callable

### Crosslink TDD Agent

**Domain:** Test-first development of the crosslink strategy with keyword matching, semantic matching, and quality safeguards.

**Task:** 5.3

**Files created (in strict order):**

| Order | File | Commit |
|-------|------|--------|
| 1 | `tests/lib/strategies/crosslink.test.ts` | RED: 16 failing tests |
| 2 | `src/lib/strategies/crosslink.ts` | GREEN: implementation passes all 16 |
| 3 | `tests/lib/strategies/registry.test.ts` | RED: 2 failing tests |
| 4 | (registry.ts already exists from Types Agent) | GREEN: registry tests pass |

**Test cases (from Implementation Plan):**

**`tests/lib/strategies/crosslink.test.ts` (16 tests):**
- `it("finds_exact_title_match_in_body_text")`
- `it("finds_fuzzy_match_with_dice_coefficient")`
- `it("skips_self_links")`
- `it("skips_existing_linked_pairs")`
- `it("skips_noindex_targets")`
- `it("respects_max_links_per_page")`
- `it("skips_anchors_inside_headings")`
- `it("skips_anchors_inside_existing_links")`
- `it("rejects_generic_anchor_text")`
- `it("enforces_minimum_word_count_for_sources")`
- `it("returns_empty_for_single_article_index")`
- `it("returns_empty_for_empty_index")`
- `it("captures_source_context_and_char_offsets")`
- `it("strips_common_title_prefixes_before_matching")` [AAP-O6]
- `it("rejects_matches_with_fewer_than_3_distinctive_words")` [AAP-O6]
- `it("uses_conservative_defaults_when_existingLinks_is_null")` [AAP-O7]

**`tests/lib/strategies/registry.test.ts` (2 tests):**
- `it("registers_and_retrieves_strategy")`
- `it("analyzeWithAll_runs_all_registered_strategies")`

**Test environment setup:** Crosslink tests use mock Article objects and ArticleSummary arrays with controlled body text, titles, and metadata. The `loadArticleBodies` callback is stubbed to return a Map from a predefined set. Semantic matching tests mock `findSimilarArticles` from the embeddings module. No database required for unit tests.

**TDD discipline:** The agent commits the failing test file before writing any implementation code. The test file is the spec. Two commits minimum per test/implementation pair (red, green).

**Internal modules within `crosslink.ts`:**
- **KeywordMatcher:** Text normalization (lowercase, strip HTML, NFC, collapse whitespace), tokenization (2-6 word n-grams with char offsets), DOM-aware matching via cheerio (skip `<a>`, `<h1>`-`<h6>`, `<img alt>`, `<code>`, `<pre>`, `<nav>`, `<footer>`, `<header>`), [AAP-O6] title prefix stripping ("How to", "A Guide to", "The Best", "What is", "Introduction to", "Getting Started with", numbered list prefixes), [AAP-O6] minimum distinctive word coverage (60% of distinctive words, penalize < 3 distinctive words), exact matching (Set/Map lookup), fuzzy matching (Dice coefficient threshold 0.8), scoring (base + position boost + target quality boost - concentration penalty), severity (critical >= 0.85, warning >= 0.6, info < 0.6).
- **SemanticMatcher:** Two-phase coarse/fine approach. Phase 1: pgvector `<=>` top 20 candidates. Phase 2: chunk-to-chunk similarity (~500 tokens, 50-token overlap). Anchor text derivation from highest-similarity chunk pair. Thresholds: article-level > 0.75, chunk-pair > 0.80.
- **Quality safeguards (12 rules):** No self-links (post-canonicalization), no duplicate links (check existingLinks; [AAP-O7] null = assume 5), no noindex targets, no error pages (4xx/5xx), no non-canonical URLs, max links per page (existing + pending + new <= cap; [AAP-O7] null existingLinks = conservative estimate 5), no cross-language linking, min 2 words / max 8 words anchor text, no anchoring in forbidden DOM zones, no generic anchors ("click here", "read more"), min 300 words for sources, min 2 articles for analysis.

### Analysis TDD Agent

**Domain:** Test-first development of dedup-ranker, re-analysis scope computation, and analysis orchestrator.

**Tasks:** 5.5, 5.6, 5.7

**Files created (in strict order):**

| Order | File | Source Task | Commit |
|-------|------|------------|--------|
| 1 | `tests/lib/analysis/dedup-ranker.test.ts` | 5.5 | RED: 4 failing tests |
| 2 | `src/lib/analysis/dedup-ranker.ts` | 5.5 | GREEN: passes all 4 |
| 3 | `tests/lib/analysis/re-analysis.test.ts` | 5.6 | RED: 5 failing tests |
| 4 | `src/lib/analysis/re-analysis.ts` | 5.6 | GREEN: passes all 5 |
| 5 | `tests/lib/analysis/orchestrator.test.ts` | 5.7 | RED: 3 failing tests |
| 6 | `src/lib/analysis/orchestrator.ts` | 5.7 | GREEN: passes all 3 |

**Test cases (from Implementation Plan):**

**`tests/lib/analysis/dedup-ranker.test.ts` (4 tests):**
- `it("merges_keyword_and_semantic_for_same_pair")`
- `it("boosts_confidence_on_dual_match")`
- `it("ranks_by_severity_then_confidence")`
- `it("applies_max_links_per_page_cap")`

**`tests/lib/analysis/re-analysis.test.ts` (5 tests):**
- `it("identifies_new_articles_since_last_run")`
- `it("identifies_changed_articles_by_hash")`
- `it("preserves_accepted_recommendations")`
- `it("skips_dismissed_when_content_unchanged")`
- `it("regenerates_dismissed_when_content_changed")`

**`tests/lib/analysis/orchestrator.test.ts` (3 tests):**
- `it("creates_run_and_transitions_to_completed")`
- `it("transitions_to_failed_with_no_partial_recs")`
- `it("tracks_embedding_cache_counters")`

**Test environment setup:** Dedup-ranker tests use plain Recommendation arrays -- no database. Re-analysis tests mock Prisma queries to return controlled Article and Recommendation sets. Orchestrator tests mock the strategy registry, embedding provider, and Prisma client.

**TDD discipline:** The agent commits the failing test file before writing any implementation code. Two commits minimum per test/implementation pair (red, green).

**Implementation notes:**
- [AAP-B4] When saving new recommendations in a transaction, mark all `pending` recommendations from previous runs for the same (sourceArticleId, targetArticleId, strategyId) triple as `superseded`.
- [AAP-B7/B11/O2] Orchestrator uses chunked async processing via cron. Initial call creates AnalysisRun (status: pending), cron worker claims and processes in batches of 200.
- [AAP-F4] Zombie recovery: AnalysisRun in `running` status > 10 minutes is marked `failed` with "Analysis timed out. Please try again."
- [AAP-B10] Foreign key violations (article deleted during analysis) are handled gracefully: skip the recommendation, log the skip, continue processing.
- [AAP-O8] `dryRun` mode computes re-analysis scope and embedding estimate without creating an AnalysisRun.

### API Agent

**Domain:** Analysis API routes, cron worker, runs endpoints.

**Task:** 5.8

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/api/analyze/route.ts` | 5.8 (POST /api/analyze: dryRun support [AAP-O8], 202 Accepted, plan limit check, error codes NO_ARTICLES/ANALYSIS_IN_PROGRESS/free tier exceeded) |
| `src/app/api/cron/analyze/route.ts` | 5.8 (cron worker [AAP-B7/B11/O2]: claims pending/running runs with FOR UPDATE SKIP LOCKED, batch processing, zombie recovery [AAP-F4], verifyCronSecret) |
| `src/app/api/runs/route.ts` | 5.8 (GET /api/runs: paginated list of AnalysisRun records) |
| `src/app/api/runs/[id]/route.ts` | 5.8 (GET /api/runs/[id]: full run detail with recommendation summary) |
| `src/app/api/runs/[id]/cancel/route.ts` | 5.8 (POST /api/runs/[id]/cancel [AAP-F4]: sets status to cancelled, 404 if not found, 409 if already completed/failed) |

**Notes:**
- POST /api/analyze with `dryRun: true` returns `200 OK` with `{ articleCount, embeddingEstimate: { cached, needsGeneration }, estimatedCost }` without creating an AnalysisRun [AAP-O8].
- POST /api/analyze without `dryRun` returns `202 Accepted` with `{ runId, status: "pending", articleCount, embeddingEstimate }`.
- Cron worker runs every minute. Add entry to `vercel.json` and function config with maxDuration: 300.
- All routes use `scopedPrisma(projectId)` for tenant isolation.
- Error codes per Client Success plan: 400 `NO_ARTICLES`, 409 `ANALYSIS_IN_PROGRESS` (enforced by [AAP-B3] partial unique index), 403 with upgrade messaging for free tier.

**Verification commands:**
- `npx tsc --noEmit` passes
- `npm run build` succeeds
- Routes respond with correct status codes

---

## Execution Flow

```
Phase A ── sequential (Types Agent runs FIRST)
  Types Agent creates strategy interface on feature/phase-5-types
  Commits, verifies: typecheck passes, interfaces export correctly

Phase B ── parallel (worktree isolation, branched from Types Agent output)
  Crosslink TDD Agent  ─► feature/phase-5-crosslink  (own worktree)
  Analysis TDD Agent   ─► feature/phase-5-analysis    (own worktree)
  API Agent            ─► feature/phase-5-api          (own worktree)

Phase C ── sequential merge into feature/phase-5
  1. Merge feature/phase-5-types     → feature/phase-5
  2. Merge feature/phase-5-crosslink → feature/phase-5
  3. Merge feature/phase-5-analysis  → feature/phase-5
  4. Merge feature/phase-5-api       → feature/phase-5
  5. Integration verification pass
  6. PR feature/phase-5 → develop
```

### Merge Order Rationale

Types Agent first because it creates the `SEOStrategy` interface, `ArticleSummary`, `AnalysisContext`, and `Recommendation` types used by all other agents. Crosslink TDD Agent second because it creates `crosslink.ts` which is imported by `src/lib/strategies/index.ts` (from Types Agent -- the commented import is uncommented during merge). Analysis TDD Agent third because the orchestrator imports from the strategy registry and crosslink strategy. API Agent last because its routes call the orchestrator and reference all types.

### Expected Conflicts

- **`src/lib/strategies/index.ts`:** Types Agent creates this file with a commented/stubbed crosslink import. After Crosslink TDD Agent merges, the import must be uncommented. This is a minor manual fix during merge, not an automatic conflict.
- **No file overlap between parallel agents:** Crosslink TDD Agent owns `crosslink.ts` and `crosslink.test.ts`. Analysis TDD Agent owns `analysis/*.ts` and `analysis/*.test.ts`. API Agent owns `app/api/analyze/`, `app/api/cron/analyze/`, `app/api/runs/`. Types Agent owns `strategies/types.ts`, `strategies/registry.ts`, `strategies/index.ts`.
- **`registry.test.ts`:** Created by Crosslink TDD Agent (tests the registry from Types Agent). No conflict since Types Agent does not create test files.

---

## Integration Verification

After all four branches merge into `feature/phase-5`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Types pass | `npx tsc --noEmit` | Exit 0 |
| Crosslink tests pass | `npx vitest tests/lib/strategies/crosslink.test.ts --run` | 16/16 passing |
| Registry tests pass | `npx vitest tests/lib/strategies/registry.test.ts --run` | 2/2 passing |
| Dedup-ranker tests pass | `npx vitest tests/lib/analysis/dedup-ranker.test.ts --run` | 4/4 passing |
| Re-analysis tests pass | `npx vitest tests/lib/analysis/re-analysis.test.ts --run` | 5/5 passing |
| Orchestrator tests pass | `npx vitest tests/lib/analysis/orchestrator.test.ts --run` | 3/3 passing |
| All tests pass | `npx vitest --run` | All passing (including prior phases) |
| Build succeeds | `npm run build` | Exit 0 |

### Manual

| Check | Location |
|-------|----------|
| SEOStrategy interface with id, name, description, analyze, configure | `src/lib/strategies/types.ts` |
| ArticleSummary without body text [AAP-B7] | `src/lib/strategies/types.ts` |
| AnalysisContext with loadArticleBodies callback [AAP-B7] | `src/lib/strategies/types.ts` |
| StrategyRegistry with register/unregister/getStrategy/getAllStrategies/analyzeWithAll | `src/lib/strategies/registry.ts` |
| CrosslinkStrategy registered in index | `src/lib/strategies/index.ts` |
| KeywordMatcher: normalization, tokenization, DOM-aware, title prefix stripping [AAP-O6] | `src/lib/strategies/crosslink.ts` |
| SemanticMatcher: two-phase coarse/fine | `src/lib/strategies/crosslink.ts` |
| 12 quality safeguards enforced | `src/lib/strategies/crosslink.ts` |
| [AAP-O7] Conservative defaults when existingLinks is null | `src/lib/strategies/crosslink.ts` |
| Dedup-ranker merges dual matches with +0.15 confidence boost (cap 1.0) | `src/lib/analysis/dedup-ranker.ts` |
| Re-analysis preserves accepted, skips dismissed unless changed [AAP-B4] | `src/lib/analysis/re-analysis.ts` |
| Orchestrator: chunked async via cron [AAP-B7/B11/O2] | `src/lib/analysis/orchestrator.ts` |
| Zombie recovery marks stuck runs as failed after 10 min [AAP-F4] | `src/lib/analysis/orchestrator.ts` |
| Foreign key violations handled gracefully [AAP-B10] | `src/lib/analysis/orchestrator.ts` |
| POST /api/analyze with dryRun returns estimate [AAP-O8] | `src/app/api/analyze/route.ts` |
| POST /api/runs/[id]/cancel returns 200/404/409 [AAP-F4] | `src/app/api/runs/[id]/cancel/route.ts` |
| Cron worker verifies CRON_SECRET | `src/app/api/cron/analyze/route.ts` |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] Keyword matching finds exact title matches in article bodies
- [ ] Fuzzy matching finds near-matches using Dice coefficient
- [ ] DOM-aware matching skips headings, existing links, code blocks
- [ ] Semantic matching returns similar articles via pgvector
- [ ] Deduplication merges keyword+semantic for same pair with confidence boost
- [ ] Re-analysis preserves accepted recommendations
- [ ] Re-analysis skips dismissed unless content changed
- [ ] Analysis fails cleanly with no partial recommendations
- [ ] `POST /api/analyze` returns 202 with run ID and embedding estimate
- [ ] Free tier limits enforced correctly
- [ ] All quality safeguards (self-link, noindex, max links, etc.) are enforced
- [ ] [AAP-O2] Analysis processes via cron worker, not inline in the API route
- [ ] [AAP-O8] `dryRun: true` returns estimate without starting analysis
- [ ] [AAP-F4] Cancel endpoint stops in-progress analysis
- [ ] [AAP-F4] Zombie recovery marks stuck analysis runs as failed after 10 minutes
- [ ] [AAP-B4] Previous-run pending recommendations are superseded on new run
- [ ] [AAP-O6] Common title prefixes do not generate false positive matches
- [ ] [AAP-O7] Articles with null existingLinks use conservative defaults in safeguards
