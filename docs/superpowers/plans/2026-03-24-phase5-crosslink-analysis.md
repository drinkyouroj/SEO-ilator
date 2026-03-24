# Phase 5: Crosslink Strategy & Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the strategy registry, crosslink strategy (keyword + semantic matching with 12 quality safeguards), dedup-ranker, re-analysis scope, analysis orchestrator, and all analysis API routes.

**Architecture:** Strategy registry pattern where strategies implement `SEOStrategy` interface. The crosslink strategy uses a two-approach system: keyword/phrase matching (exact + Dice fuzzy) and semantic similarity (pgvector). The analysis orchestrator processes articles in batches via cron for async execution. Recommendations are deduplicated, ranked, and stored with superseding logic for re-analysis.

**Tech Stack:** Next.js 16 App Router, Prisma 7, cheerio (DOM-aware matching), pgvector (semantic similarity via `findSimilarArticles`), `processEmbeddings` (batch embedding), Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-phase-5-tdd-agent-team-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|---|---|
| `src/lib/strategies/types.ts` | SEOStrategy interface, ArticleSummary, AnalysisContext, StrategyRecommendation |
| `src/lib/strategies/registry.ts` | StrategyRegistry class: register, unregister, getStrategy, analyzeWithAll |
| `src/lib/strategies/crosslink.ts` | CrosslinkStrategy: keyword matcher, semantic matcher, quality safeguards |
| `src/lib/strategies/index.ts` | Strategy registration entrypoint |
| `src/lib/analysis/dedup-ranker.ts` | Merge keyword+semantic matches, rank by severity+confidence, cap per page |
| `src/lib/analysis/re-analysis.ts` | Compute re-analysis scope: new/changed articles, preserve accepted, supersede |
| `src/lib/analysis/orchestrator.ts` | Analysis orchestrator: create run, batch process, embed, analyze, store |
| `src/app/api/analyze/route.ts` | POST /api/analyze: dryRun + start analysis |
| `src/app/api/cron/analyze/route.ts` | GET: analysis cron worker with zombie recovery |
| `src/app/api/runs/route.ts` | GET /api/runs: paginated list |
| `src/app/api/runs/[id]/route.ts` | GET /api/runs/[id]: run detail |
| `src/app/api/runs/[id]/cancel/route.ts` | POST: cancel analysis run |
| `tests/lib/strategies/crosslink.test.ts` | 16 crosslink tests |
| `tests/lib/strategies/registry.test.ts` | 2 registry tests |
| `tests/lib/analysis/dedup-ranker.test.ts` | 4 dedup-ranker tests |
| `tests/lib/analysis/re-analysis.test.ts` | 5 re-analysis tests |
| `tests/lib/analysis/orchestrator.test.ts` | 3 orchestrator tests |

---

## Task 0: Schema Migration — AAP-B3 Partial Unique Index + lastHeartbeatAt

**Files:**
- Modify: `prisma/schema.prisma` (AnalysisRun model)

- [ ] **Step 1: Add partial unique index and lastHeartbeatAt to AnalysisRun**

In `prisma/schema.prisma`, add to the `AnalysisRun` model:

```prisma
lastHeartbeatAt DateTime?
```

And add the partial unique index to prevent concurrent active runs [AAP-B3]:

Note: Prisma doesn't support partial unique indexes natively. Create the migration with `--create-only` and add raw SQL:

```sql
CREATE UNIQUE INDEX "AnalysisRun_projectId_active_unique"
ON "AnalysisRun" ("projectId")
WHERE status IN ('pending', 'running');

ALTER TABLE "AnalysisRun" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);
```

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --create-only --name add-analysis-run-heartbeat-and-active-index`

Then manually edit the generated SQL file to include both the ALTER TABLE and CREATE UNIQUE INDEX statements.

- [ ] **Step 3: Regenerate Prisma client**

Run: `npx prisma generate`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add lastHeartbeatAt and AAP-B3 partial unique index to AnalysisRun"
```

---

## Task 1: Strategy Types & Interfaces

**Files:**
- Create: `src/lib/strategies/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * Core types for the strategy registry pattern.
 * All SEO strategies implement SEOStrategy and register with the registry.
 */

/** Slimmed-down article without full body text [AAP-B7] to prevent OOM on large indexes. */
export interface ArticleSummary {
  id: string;
  url: string;
  title: string;
  wordCount: number;
  existingLinks: { href: string; anchorText: string }[] | null;
  hasEmbedding: boolean;
  canonicalUrl: string | null;
  noindex: boolean;
  nofollow: boolean;
  httpStatus: number | null;
  parseWarning: string | null;
}

/**
 * Context provided to each strategy during analysis.
 * [AAP-B7] articleIndex uses ArticleSummary (no body text).
 * loadArticleBodies provides on-demand body loading in batches.
 */
export interface AnalysisContext {
  /** The article being analyzed */
  article: ArticleSummary;
  /** All articles in the project (slimmed-down, no body text) */
  articleIndex: ArticleSummary[];
  /** Load full body text for specific articles on demand [AAP-B7] */
  loadArticleBodies: (ids: string[]) => Promise<Map<string, string>>;
  /** Project ID for tenant-scoped queries */
  projectId: string;
  /** Strategy-specific configuration */
  settings: Record<string, unknown>;
}

/** A recommendation produced by a strategy (before database persistence). */
export interface StrategyRecommendation {
  strategyId: string;
  sourceArticleId: string;
  targetArticleId: string;
  type: "crosslink" | "meta" | "keyword" | "content_quality" | string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  anchorText?: string;
  confidence: number;
  matchingApproach?: "keyword" | "semantic" | "both";
  sourceContext?: string;
  charOffsetStart?: number;
  charOffsetEnd?: number;
  suggestion?: Record<string, unknown>;
}

/** Contract that all SEO strategy plugins implement. */
export interface SEOStrategy {
  /** Unique identifier for the strategy */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description shown in the dashboard */
  description: string;
  /** Analyze an article against the index and return recommendations */
  analyze(context: AnalysisContext): Promise<StrategyRecommendation[]>;
  /** Optional: configure strategy-specific settings */
  configure?(settings: Record<string, unknown>): void;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/strategies/types.ts
git commit -m "feat(strategies): add SEOStrategy interface and ArticleSummary types [AAP-B7]"
```

---

## Task 2: Strategy Registry (TDD)

**Files:**
- Create: `tests/lib/strategies/registry.test.ts`
- Create: `src/lib/strategies/registry.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { StrategyRegistry } from "@/lib/strategies/registry";
import type { SEOStrategy, AnalysisContext, StrategyRecommendation } from "@/lib/strategies/types";

const mockStrategy = (id: string, recs: StrategyRecommendation[] = []): SEOStrategy => ({
  id,
  name: `Strategy ${id}`,
  description: `Mock strategy ${id}`,
  analyze: vi.fn().mockResolvedValue(recs),
});

describe("StrategyRegistry", () => {
  it("registers_and_retrieves_strategy", () => {
    const registry = new StrategyRegistry();
    const strategy = mockStrategy("crosslink");

    registry.register(strategy);
    expect(registry.getStrategy("crosslink")).toBe(strategy);
    expect(registry.getAllStrategies()).toHaveLength(1);

    registry.unregister("crosslink");
    expect(registry.getStrategy("crosslink")).toBeUndefined();
    expect(registry.getAllStrategies()).toHaveLength(0);
  });

  it("analyzeWithAll_runs_all_registered_strategies", async () => {
    const registry = new StrategyRegistry();
    const rec1: StrategyRecommendation = {
      strategyId: "s1",
      sourceArticleId: "a1",
      targetArticleId: "a2",
      type: "crosslink",
      severity: "warning",
      title: "Link to A2",
      description: "Test",
      confidence: 0.8,
    };
    const rec2: StrategyRecommendation = {
      strategyId: "s2",
      sourceArticleId: "a1",
      targetArticleId: "a3",
      type: "meta",
      severity: "info",
      title: "Meta issue",
      description: "Test",
      confidence: 0.5,
    };

    registry.register(mockStrategy("s1", [rec1]));
    registry.register(mockStrategy("s2", [rec2]));

    const context = {
      article: { id: "a1", url: "https://example.com/a1", title: "A1", wordCount: 500, existingLinks: [], hasEmbedding: true, canonicalUrl: null, noindex: false, nofollow: false, httpStatus: 200, parseWarning: null },
      articleIndex: [],
      loadArticleBodies: vi.fn(),
      projectId: "proj-1",
      settings: {},
    } satisfies AnalysisContext;

    const results = await registry.analyzeWithAll(context);
    expect(results).toHaveLength(2);
    expect(results[0].strategyId).toBe("s1");
    expect(results[1].strategyId).toBe("s2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/strategies/registry.test.ts --run`

- [ ] **Step 3: Implement the registry**

```typescript
import type { SEOStrategy, AnalysisContext, StrategyRecommendation } from "./types";

/**
 * Central registry for SEO strategy plugins.
 * Strategies register themselves at app startup.
 */
export class StrategyRegistry {
  private strategies = new Map<string, SEOStrategy>();

  register(strategy: SEOStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  unregister(id: string): void {
    this.strategies.delete(id);
  }

  getStrategy(id: string): SEOStrategy | undefined {
    return this.strategies.get(id);
  }

  getAllStrategies(): SEOStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Run all registered strategies against the given context.
   * Each strategy runs independently — no cross-strategy dedup here.
   */
  async analyzeWithAll(context: AnalysisContext): Promise<StrategyRecommendation[]> {
    const results: StrategyRecommendation[] = [];
    for (const strategy of this.strategies.values()) {
      const recs = await strategy.analyze(context);
      results.push(...recs);
    }
    return results;
  }
}

/** Singleton registry instance. */
export const registry = new StrategyRegistry();
```

- [ ] **Step 4: Commit RED (failing tests)**

```bash
git add tests/lib/strategies/registry.test.ts
git commit -m "test(strategies): add registry tests (RED)"
```

- [ ] **Step 5: Run tests to verify they pass after implementation**

Run: `npx vitest tests/lib/strategies/registry.test.ts --run`

- [ ] **Step 6: Commit GREEN (implementation)**

```bash
git add src/lib/strategies/registry.ts
git commit -m "feat(strategies): add StrategyRegistry with register/analyzeWithAll (GREEN)"
```

---

## Task 3: Crosslink Strategy — Keyword Matcher (TDD)

This is the most complex single file in the project. The crosslink strategy has two matchers (keyword + semantic) and 12 quality safeguards. We'll implement and test the keyword matcher first, then add semantic matching, then wire them together.

**Files:**
- Create: `tests/lib/strategies/crosslink.test.ts`
- Create: `src/lib/strategies/crosslink.ts`

- [ ] **Step 1: Write all 15 keyword/quality tests (16 total with semantic)**

```typescript
import { describe, it, expect, vi } from "vitest";
import { CrosslinkStrategy } from "@/lib/strategies/crosslink";
import type { AnalysisContext, ArticleSummary } from "@/lib/strategies/types";

// Mock the semantic similarity module — keyword tests don't need it
vi.mock("@/lib/embeddings/similarity", () => ({
  findSimilarArticles: vi.fn().mockResolvedValue([]),
}));

const makeArticle = (overrides?: Partial<ArticleSummary>): ArticleSummary => ({
  id: "source-1",
  url: "https://example.com/source",
  title: "Source Article",
  wordCount: 500,
  existingLinks: [],
  hasEmbedding: false,
  canonicalUrl: null,
  noindex: false,
  nofollow: false,
  httpStatus: 200,
  parseWarning: null,
  ...overrides,
});

const makeContext = (
  article: ArticleSummary,
  index: ArticleSummary[],
  bodies: Record<string, string> = {}
): AnalysisContext => ({
  article,
  articleIndex: index,
  loadArticleBodies: vi.fn().mockResolvedValue(new Map(Object.entries(bodies))),
  projectId: "proj-1",
  settings: {},
});

describe("CrosslinkStrategy — keyword matching", () => {
  const strategy = new CrosslinkStrategy();

  it("finds_exact_title_match_in_body_text", async () => {
    const source = makeArticle({ id: "a1", title: "Source Page", wordCount: 500 });
    const target = makeArticle({ id: "a2", title: "React Hooks Guide", url: "https://example.com/react-hooks" });
    const bodies = { "a1": "Learn about React Hooks Guide and other topics in this comprehensive tutorial." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs.some((r) => r.targetArticleId === "a2")).toBe(true);
    expect(recs.find((r) => r.targetArticleId === "a2")?.matchingApproach).toBe("keyword");
  });

  it("skips_self_links", async () => {
    const article = makeArticle({ id: "a1", title: "Self Page", wordCount: 500 });
    const bodies = { "a1": "This page mentions Self Page in its own body text." };
    const ctx = makeContext(article, [article], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs.filter((r) => r.targetArticleId === "a1")).toHaveLength(0);
  });

  it("skips_existing_linked_pairs", async () => {
    const source = makeArticle({
      id: "a1",
      wordCount: 500,
      existingLinks: [{ href: "https://example.com/target", anchorText: "Target" }],
    });
    const target = makeArticle({ id: "a2", title: "Target", url: "https://example.com/target" });
    const bodies = { "a1": "Read about Target in this article about various topics and techniques." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs.filter((r) => r.targetArticleId === "a2")).toHaveLength(0);
  });

  it("skips_noindex_targets", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    const target = makeArticle({ id: "a2", title: "Hidden Page", noindex: true });
    const bodies = { "a1": "We discuss Hidden Page extensively in this guide." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs.filter((r) => r.targetArticleId === "a2")).toHaveLength(0);
  });

  it("enforces_minimum_word_count_for_sources", async () => {
    const source = makeArticle({ id: "a1", wordCount: 100 }); // Below 300 threshold
    const target = makeArticle({ id: "a2", title: "Some Topic" });
    const bodies = { "a1": "Short page about Some Topic." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs).toHaveLength(0);
  });

  it("returns_empty_for_single_article_index", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    const bodies = { "a1": "Only one article in the index." };
    const ctx = makeContext(source, [source], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs).toHaveLength(0);
  });

  it("returns_empty_for_empty_index", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    const ctx = makeContext(source, [], {});

    const recs = await strategy.analyze(ctx);
    expect(recs).toHaveLength(0);
  });

  it("strips_common_title_prefixes_before_matching", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    const target = makeArticle({ id: "a2", title: "How to Use TypeScript Generics" });
    // Body contains "TypeScript Generics" but not "How to Use TypeScript Generics"
    const bodies = { "a1": "This article explains TypeScript Generics with practical examples and patterns." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    // Should match on "TypeScript Generics" after stripping "How to"
    expect(recs.some((r) => r.targetArticleId === "a2")).toBe(true);
  });

  it("rejects_matches_with_fewer_than_3_distinctive_words", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    const target = makeArticle({ id: "a2", title: "The Best" }); // Only 2 words, and both are common
    const bodies = { "a1": "This is the best guide about programming in the entire world." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs.filter((r) => r.targetArticleId === "a2")).toHaveLength(0);
  });

  it("finds_fuzzy_match_with_dice_coefficient", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    // Title is "React Hook Patterns" but body says "React Hooks Pattern" (slight variation)
    const target = makeArticle({ id: "a2", title: "React Hook Patterns" });
    const bodies = { "a1": "Learn about React Hooks Pattern and how to apply them in your components for better state management." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs.some((r) => r.targetArticleId === "a2")).toBe(true);
  });

  it("respects_max_links_per_page", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500, existingLinks: [] });
    // Create many targets — more than the per-page cap
    const targets = Array.from({ length: 20 }, (_, i) =>
      makeArticle({ id: `t${i}`, title: `Unique Topic ${i} Explained`, url: `https://example.com/t${i}` })
    );
    const bodyText = targets.map((t) => t.title).join(". ") + ".";
    const bodies = { "a1": bodyText };
    const ctx = makeContext(source, [source, ...targets], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs.length).toBeLessThanOrEqual(10); // MAX_NEW_LINKS cap
  });

  it("rejects_generic_anchor_text", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    const target = makeArticle({ id: "a2", title: "Click Here" });
    const bodies = { "a1": "Please click here to learn more about this topic and find resources." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    expect(recs.filter((r) => r.targetArticleId === "a2")).toHaveLength(0);
  });

  it("captures_source_context_and_char_offsets", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    const target = makeArticle({ id: "a2", title: "TypeScript Generics" });
    const bodies = { "a1": "This article covers TypeScript Generics with examples for advanced developers." };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    const rec = recs.find((r) => r.targetArticleId === "a2");
    expect(rec).toBeDefined();
    expect(rec?.sourceContext).toBeDefined();
    expect(typeof rec?.charOffsetStart).toBe("number");
    expect(typeof rec?.charOffsetEnd).toBe("number");
  });

  it("sanitizes_anchor_text_against_xss", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500 });
    // Malicious title from a crawled site
    const target = makeArticle({ id: "a2", title: '<script>alert("xss")</script> Real Title' });
    const bodies = { "a1": 'The article discusses <script>alert("xss")</script> Real Title concepts.' };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    // If a match is found, the anchorText must be sanitized (no HTML tags)
    for (const rec of recs) {
      if (rec.anchorText) {
        expect(rec.anchorText).not.toContain("<script>");
        expect(rec.anchorText).not.toContain("javascript:");
      }
    }
  });

  it("uses_conservative_defaults_when_existingLinks_is_null", async () => {
    // existingLinks = null means data unavailable — assume 5 existing links [AAP-O7]
    const source = makeArticle({ id: "a1", wordCount: 500, existingLinks: null });
    const targets = Array.from({ length: 20 }, (_, i) =>
      makeArticle({ id: `t${i}`, title: `Unique Topic Number ${i} Article`, url: `https://example.com/t${i}` })
    );
    const bodyText = targets.map((t) => t.title).join(". ") + ".";
    const bodies = { "a1": bodyText };
    const ctx = makeContext(source, [source, ...targets], bodies);

    const recs = await strategy.analyze(ctx);
    // With null existingLinks, assumes 5 existing links.
    // Max links per page should limit recommendations accordingly.
    // The exact cap depends on implementation, but it should be < 20.
    expect(recs.length).toBeLessThan(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/strategies/crosslink.test.ts --run`

Expected: FAIL — `CrosslinkStrategy` not defined.

- [ ] **Step 3: Implement the CrosslinkStrategy**

This is the largest single implementation. The strategy should:

1. **Guard clauses:** Return empty if < 2 articles, source wordCount < 300
2. **Load body text** for the source article via `loadArticleBodies`
3. **For each target in articleIndex** (excluding self, noindex, error pages):
   - Check if source already links to target (via existingLinks, or assume 5 if null [AAP-O7])
   - **Keyword matching:** Strip common title prefixes [AAP-O6], check if stripped title (or significant n-grams of it) appears in source body text
   - Require >= 60% distinctive word coverage and >= 3 distinctive words [AAP-O6]
   - Compute confidence score based on match quality
4. **Quality safeguards:** max links per page cap (e.g., 10 new + existing), no generic anchors, min/max anchor text length
5. **Return StrategyRecommendation[]** with confidence, severity, sourceContext, charOffsets

Key constants:
- `MIN_SOURCE_WORDS = 300`
- `MIN_DISTINCTIVE_WORDS = 3`
- `DISTINCTIVE_COVERAGE = 0.6` (60%)
- `MAX_NEW_LINKS = 10`
- `NULL_LINKS_ESTIMATE = 5` [AAP-O7]
- `GENERIC_ANCHORS = ["click here", "read more", "learn more", "this article", "this page", "here"]`
- `TITLE_PREFIXES = ["how to", "a guide to", "the best", "what is", "introduction to", "getting started with"]`

The implementation should be a class implementing `SEOStrategy` with private helper methods for:
- `stripTitlePrefix(title: string): string`
- `getDistinctiveWords(title: string): string[]`
- `findKeywordMatches(body: string, targets: ArticleSummary[]): Match[]`

Semantic matching is deferred to a separate step (Task 4) — for now, return keyword matches only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/strategies/crosslink.test.ts --run`

Expected: All 15 tests PASS.

Key implementation note: Add a `sanitizeAnchorText(raw: string): string` helper that strips HTML tags and rejects URI schemes other than `http(s)://`. This is a security requirement per AAP review.

- [ ] **Step 5: Commit**

```bash
git add src/lib/strategies/crosslink.ts tests/lib/strategies/crosslink.test.ts
git commit -m "feat(strategies): add crosslink strategy with keyword matching, quality safeguards, and XSS sanitization [AAP-O6, AAP-O7]"
```

---

## Task 4: Crosslink Strategy — Semantic Matching

**Files:**
- Modify: `src/lib/strategies/crosslink.ts`
- Modify: `tests/lib/strategies/crosslink.test.ts`

- [ ] **Step 1: Add semantic matching tests**

Add to the existing test file:

```typescript
import { findSimilarArticles } from "@/lib/embeddings/similarity";

describe("CrosslinkStrategy — semantic matching", () => {
  const strategy = new CrosslinkStrategy();

  it("finds_semantic_matches_via_pgvector", async () => {
    const mockSimilar = vi.mocked(findSimilarArticles);
    mockSimilar.mockResolvedValueOnce([
      { id: "a2", url: "https://example.com/similar", title: "Similar Topic", similarity: 0.85 },
    ]);

    const source = makeArticle({ id: "a1", wordCount: 500, hasEmbedding: true });
    const target = makeArticle({ id: "a2", title: "Similar Topic", url: "https://example.com/similar", hasEmbedding: true });
    const ctx = makeContext(source, [source, target], {});

    const recs = await strategy.analyze(ctx);
    const semantic = recs.filter((r) => r.matchingApproach === "semantic");
    expect(semantic.length).toBeGreaterThanOrEqual(1);
    expect(semantic[0]?.targetArticleId).toBe("a2");
  });

  it("skips_semantic_when_source_has_no_embedding", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500, hasEmbedding: false });
    const target = makeArticle({ id: "a2", title: "Topic", hasEmbedding: true });
    const ctx = makeContext(source, [source, target], {});

    const recs = await strategy.analyze(ctx);
    // Should have no semantic matches since source has no embedding
    const semantic = recs.filter((r) => r.matchingApproach === "semantic");
    expect(semantic).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Add semantic matching to the strategy**

In `crosslink.ts`, after keyword matching:
1. Check if `source.hasEmbedding` — if not, skip semantic matching
2. Call `findSimilarArticles(ctx.projectId, source.id, 20, 0.751)` to get top-20 candidates strictly above 0.75 (the function uses `>=`, so pass `0.751` for `> 0.75` semantics per spec)
3. Filter out: self-links, noindex targets, already-linked targets, targets already matched by keyword
4. Apply same quality safeguards as keyword matching
5. Create `StrategyRecommendation` with `matchingApproach: "semantic"` and confidence from similarity score

- [ ] **Step 3: Run all crosslink tests**

Run: `npx vitest tests/lib/strategies/crosslink.test.ts --run`

Expected: All 17 tests PASS (15 keyword/quality + 2 semantic).

- [ ] **Step 4: Commit**

```bash
git add src/lib/strategies/crosslink.ts tests/lib/strategies/crosslink.test.ts
git commit -m "feat(strategies): add semantic matching to crosslink strategy via pgvector"
```

---

## Task 5: Strategy Registration Entrypoint

**Files:**
- Create: `src/lib/strategies/index.ts`

- [ ] **Step 1: Create the registration entrypoint**

```typescript
import { registry } from "./registry";
import { CrosslinkStrategy } from "./crosslink";

// Register all strategies at import time
registry.register(new CrosslinkStrategy());

export { registry };
export type { SEOStrategy, AnalysisContext, StrategyRecommendation, ArticleSummary } from "./types";
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/strategies/index.ts
git commit -m "feat(strategies): add strategy registration entrypoint"
```

---

## Task 6: Dedup-Ranker (TDD)

**Files:**
- Create: `tests/lib/analysis/dedup-ranker.test.ts`
- Create: `src/lib/analysis/dedup-ranker.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { dedupAndRank } from "@/lib/analysis/dedup-ranker";
import type { StrategyRecommendation } from "@/lib/strategies/types";

const makeRec = (overrides?: Partial<StrategyRecommendation>): StrategyRecommendation => ({
  strategyId: "crosslink",
  sourceArticleId: "a1",
  targetArticleId: "a2",
  type: "crosslink",
  severity: "warning",
  title: "Link suggestion",
  description: "Test",
  confidence: 0.7,
  matchingApproach: "keyword",
  ...overrides,
});

describe("dedupAndRank", () => {
  it("merges_keyword_and_semantic_for_same_pair", () => {
    const keyword = makeRec({ matchingApproach: "keyword", confidence: 0.7 });
    const semantic = makeRec({ matchingApproach: "semantic", confidence: 0.8 });

    const result = dedupAndRank([keyword, semantic]);
    // Same source-target pair should merge into one rec with approach "both"
    expect(result).toHaveLength(1);
    expect(result[0].matchingApproach).toBe("both");
  });

  it("boosts_confidence_on_dual_match", () => {
    const keyword = makeRec({ matchingApproach: "keyword", confidence: 0.7 });
    const semantic = makeRec({ matchingApproach: "semantic", confidence: 0.8 });

    const result = dedupAndRank([keyword, semantic]);
    // Max confidence + 0.15 boost, capped at 1.0
    expect(result[0].confidence).toBeCloseTo(0.95); // max(0.7, 0.8) + 0.15
  });

  it("ranks_by_severity_then_confidence", () => {
    const critical = makeRec({ sourceArticleId: "a1", targetArticleId: "a2", severity: "critical", confidence: 0.5 });
    const warningHigh = makeRec({ sourceArticleId: "a1", targetArticleId: "a3", severity: "warning", confidence: 0.9 });
    const warningLow = makeRec({ sourceArticleId: "a1", targetArticleId: "a4", severity: "warning", confidence: 0.6 });

    const result = dedupAndRank([warningLow, critical, warningHigh]);
    expect(result[0].severity).toBe("critical");
    expect(result[1].confidence).toBeGreaterThan(result[2].confidence);
  });

  it("applies_max_links_per_page_cap", () => {
    const recs = Array.from({ length: 20 }, (_, i) =>
      makeRec({ targetArticleId: `t${i}`, confidence: 0.5 + i * 0.02 })
    );

    const result = dedupAndRank(recs, { maxNewLinksPerPage: 5 });
    expect(result.length).toBeLessThanOrEqual(5);
    // Should keep the highest-confidence ones
    expect(result[0].confidence).toBeGreaterThan(result[result.length - 1].confidence);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement**

```typescript
import type { StrategyRecommendation } from "@/lib/strategies/types";

const DUAL_MATCH_BOOST = 0.15;
const SEVERITY_ORDER: Record<string, number> = { critical: 3, warning: 2, info: 1 };

interface DedupOptions {
  maxNewLinksPerPage?: number;
}

/**
 * Merge duplicate recommendations (same source+target pair from different approaches),
 * boost confidence for dual-match pairs, rank by severity then confidence, and
 * apply per-page link caps.
 */
export function dedupAndRank(
  recs: StrategyRecommendation[],
  options: DedupOptions = {}
): StrategyRecommendation[] {
  const { maxNewLinksPerPage = 10 } = options;

  // Group by source+target pair
  const grouped = new Map<string, StrategyRecommendation[]>();
  for (const rec of recs) {
    const key = `${rec.sourceArticleId}:${rec.targetArticleId}`;
    const group = grouped.get(key) ?? [];
    group.push(rec);
    grouped.set(key, group);
  }

  // Merge groups
  const merged: StrategyRecommendation[] = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    // Multiple matches for the same pair — merge
    const hasKeyword = group.some((r) => r.matchingApproach === "keyword");
    const hasSemantic = group.some((r) => r.matchingApproach === "semantic");
    const maxConfidence = Math.max(...group.map((r) => r.confidence));
    const bestSeverity = group.reduce((best, r) =>
      (SEVERITY_ORDER[r.severity] ?? 0) > (SEVERITY_ORDER[best.severity] ?? 0) ? r : best
    );

    const boostedConfidence = hasKeyword && hasSemantic
      ? Math.min(maxConfidence + DUAL_MATCH_BOOST, 1.0)
      : maxConfidence;

    merged.push({
      ...bestSeverity,
      confidence: boostedConfidence,
      matchingApproach: hasKeyword && hasSemantic ? "both" : bestSeverity.matchingApproach,
    });
  }

  // Sort: severity desc, then confidence desc
  merged.sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });

  // Group by source and apply per-page cap
  const bySource = new Map<string, StrategyRecommendation[]>();
  for (const rec of merged) {
    const group = bySource.get(rec.sourceArticleId) ?? [];
    group.push(rec);
    bySource.set(rec.sourceArticleId, group);
  }

  const capped: StrategyRecommendation[] = [];
  for (const group of bySource.values()) {
    capped.push(...group.slice(0, maxNewLinksPerPage));
  }

  // Re-sort the final set
  capped.sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });

  return capped;
}
```

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis/dedup-ranker.ts tests/lib/analysis/dedup-ranker.test.ts
git commit -m "feat(analysis): add dedup-ranker with dual-match boost and per-page cap"
```

---

## Task 7: Re-Analysis Scope (TDD)

**Files:**
- Create: `tests/lib/analysis/re-analysis.test.ts`
- Create: `src/lib/analysis/re-analysis.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { computeReAnalysisScope } from "@/lib/analysis/re-analysis";
import type { StrategyRecommendation } from "@/lib/strategies/types";

interface MockArticle { id: string; bodyHash: string; titleHash: string }
interface MockRec { sourceArticleId: string; targetArticleId: string; strategyId: string; status: string }

describe("computeReAnalysisScope", () => {
  it("identifies_new_articles_since_last_run", () => {
    const articles: MockArticle[] = [
      { id: "a1", bodyHash: "h1", titleHash: "t1" },
      { id: "a2", bodyHash: "h2", titleHash: "t2" },
    ];
    const lastRunArticleIds = new Set(["a1"]); // a2 is new

    const scope = computeReAnalysisScope(articles, lastRunArticleIds, new Map(), []);
    expect(scope.newArticleIds).toContain("a2");
    expect(scope.newArticleIds).not.toContain("a1");
  });

  it("identifies_changed_articles_by_hash", () => {
    const articles: MockArticle[] = [
      { id: "a1", bodyHash: "new-hash", titleHash: "t1" },
    ];
    const lastRunArticleIds = new Set(["a1"]);
    const lastRunHashes = new Map([["a1", { bodyHash: "old-hash", titleHash: "t1" }]]);

    const scope = computeReAnalysisScope(articles, lastRunArticleIds, lastRunHashes, []);
    expect(scope.changedArticleIds).toContain("a1");
  });

  it("preserves_accepted_recommendations", () => {
    const articles: MockArticle[] = [{ id: "a1", bodyHash: "h1", titleHash: "t1" }];
    const existingRecs: MockRec[] = [
      { sourceArticleId: "a1", targetArticleId: "a2", strategyId: "crosslink", status: "accepted" },
    ];

    const scope = computeReAnalysisScope(articles, new Set(["a1"]), new Map([["a1", { bodyHash: "h1", titleHash: "t1" }]]), existingRecs);
    expect(scope.preservedRecIds).toHaveLength(1);
  });

  it("skips_dismissed_when_content_unchanged", () => {
    const articles: MockArticle[] = [{ id: "a1", bodyHash: "h1", titleHash: "t1" }];
    const existingRecs: MockRec[] = [
      { sourceArticleId: "a1", targetArticleId: "a2", strategyId: "crosslink", status: "dismissed" },
    ];

    const scope = computeReAnalysisScope(articles, new Set(["a1"]), new Map([["a1", { bodyHash: "h1", titleHash: "t1" }]]), existingRecs);
    expect(scope.preservedRecIds).toHaveLength(1); // Dismissed unchanged = preserve (skip re-generation)
  });

  it("regenerates_dismissed_when_content_changed", () => {
    const articles: MockArticle[] = [{ id: "a1", bodyHash: "new-hash", titleHash: "t1" }];
    const existingRecs: MockRec[] = [
      { sourceArticleId: "a1", targetArticleId: "a2", strategyId: "crosslink", status: "dismissed" },
    ];

    const scope = computeReAnalysisScope(articles, new Set(["a1"]), new Map([["a1", { bodyHash: "old-hash", titleHash: "t1" }]]), existingRecs);
    expect(scope.preservedRecIds).toHaveLength(0); // Content changed = regenerate
    expect(scope.changedArticleIds).toContain("a1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement**

```typescript
interface ReAnalysisScope {
  /** Articles not present in the last run */
  newArticleIds: string[];
  /** Articles whose bodyHash or titleHash changed since last run */
  changedArticleIds: string[];
  /** Recommendation IDs to preserve (accepted + dismissed-unchanged) */
  preservedRecIds: string[];
  /** Articles that need analysis (new + changed) */
  articlesToAnalyze: string[];
}

interface ArticleHashable {
  id: string;
  bodyHash: string;
  titleHash: string;
}

interface ExistingRec {
  id?: string;
  sourceArticleId: string;
  targetArticleId: string;
  strategyId: string;
  status: string;
}

/**
 * Compute which articles need re-analysis and which recommendations to preserve.
 * [AAP-B4] Previous-run pending recs will be superseded when new recs are saved.
 * Accepted recs are always preserved. Dismissed recs are preserved only if content unchanged.
 */
export function computeReAnalysisScope(
  articles: ArticleHashable[],
  lastRunArticleIds: Set<string>,
  lastRunHashes: Map<string, { bodyHash: string; titleHash: string }>,
  existingRecs: ExistingRec[]
): ReAnalysisScope {
  const newArticleIds: string[] = [];
  const changedArticleIds: string[] = [];
  const unchangedIds = new Set<string>();

  for (const article of articles) {
    if (!lastRunArticleIds.has(article.id)) {
      newArticleIds.push(article.id);
    } else {
      const prev = lastRunHashes.get(article.id);
      if (prev && (prev.bodyHash !== article.bodyHash || prev.titleHash !== article.titleHash)) {
        changedArticleIds.push(article.id);
      } else {
        unchangedIds.add(article.id);
      }
    }
  }

  // Determine which recommendations to preserve
  const preservedRecIds: string[] = [];
  for (const rec of existingRecs) {
    if (rec.status === "accepted") {
      // Always preserve accepted
      if (rec.id) preservedRecIds.push(rec.id);
    } else if (rec.status === "dismissed") {
      // Preserve dismissed only if source content is unchanged
      if (unchangedIds.has(rec.sourceArticleId)) {
        if (rec.id) preservedRecIds.push(rec.id);
      }
    }
    // "pending" and "superseded" recs are not preserved — pending will be superseded
  }

  return {
    newArticleIds,
    changedArticleIds,
    preservedRecIds,
    articlesToAnalyze: [...newArticleIds, ...changedArticleIds],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis/re-analysis.ts tests/lib/analysis/re-analysis.test.ts
git commit -m "feat(analysis): add re-analysis scope with accepted/dismissed preservation [AAP-B4]"
```

---

## Task 8: Analysis Orchestrator (TDD)

**Files:**
- Create: `tests/lib/analysis/orchestrator.test.ts`
- Create: `src/lib/analysis/orchestrator.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { processAnalysisRun } from "@/lib/analysis/orchestrator";

vi.mock("@/lib/db", () => ({
  prisma: {
    article: { findMany: vi.fn(), count: vi.fn() },
    analysisRun: { update: vi.fn(), findUnique: vi.fn() },
    recommendation: { createMany: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  scopedPrisma: vi.fn(() => ({
    article: { findMany: vi.fn(), count: vi.fn() },
    analysisRun: { update: vi.fn() },
    recommendation: { createMany: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  })),
}));

vi.mock("@/lib/strategies", () => ({
  registry: {
    analyzeWithAll: vi.fn().mockResolvedValue([]),
    getAllStrategies: vi.fn().mockReturnValue([{ id: "crosslink", name: "Crosslink" }]),
  },
}));

vi.mock("@/lib/embeddings/batch", () => ({
  processEmbeddings: vi.fn().mockResolvedValue({ cached: 0, generated: 0, skipped: 0 }),
}));

vi.mock("@/lib/embeddings", () => ({
  getProvider: vi.fn().mockResolvedValue({
    modelId: "openai/text-embedding-3-small",
    dimensions: 1536,
    batchSize: 2048,
    embed: vi.fn(),
  }),
}));

vi.mock("@/lib/analysis/dedup-ranker", () => ({
  dedupAndRank: vi.fn((recs) => recs),
}));

describe("processAnalysisRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates_run_and_transitions_to_completed", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.article.findMany).mockResolvedValue([]);
    vi.mocked(prisma.article.count).mockResolvedValue(0);

    // The orchestrator should update the run status
    vi.mocked(prisma.analysisRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.analysisRun.findUnique).mockResolvedValue({
      id: "run-1",
      projectId: "proj-1",
      status: "pending",
    } as never);

    await processAnalysisRun("run-1", "proj-1");

    // Should transition to completed
    expect(prisma.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      })
    );
  });

  it("transitions_to_failed_on_error", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.analysisRun.findUnique).mockResolvedValue({
      id: "run-1",
      projectId: "proj-1",
      status: "pending",
    } as never);
    vi.mocked(prisma.article.findMany).mockRejectedValue(new Error("DB connection failed"));
    vi.mocked(prisma.analysisRun.update).mockResolvedValue({} as never);

    await processAnalysisRun("run-1", "proj-1");

    expect(prisma.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("DB connection failed"),
        }),
      })
    );
  });

  it("tracks_embedding_cache_counters", async () => {
    const { prisma } = await import("@/lib/db");
    const { processEmbeddings } = await import("@/lib/embeddings/batch");

    vi.mocked(prisma.analysisRun.findUnique).mockResolvedValue({
      id: "run-1",
      projectId: "proj-1",
      status: "pending",
    } as never);
    vi.mocked(prisma.article.findMany).mockResolvedValue([]);
    vi.mocked(prisma.article.count).mockResolvedValue(0);
    vi.mocked(processEmbeddings).mockResolvedValue({ cached: 10, generated: 5, skipped: 1 });
    vi.mocked(prisma.analysisRun.update).mockResolvedValue({} as never);

    await processAnalysisRun("run-1", "proj-1");

    expect(prisma.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          embeddingsCached: 10,
          embeddingsGenerated: 5,
        }),
      })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement the orchestrator**

The orchestrator's `processAnalysisRun(runId, projectId)` function:

1. Fetch the AnalysisRun and verify it's in pending/running status
2. Transition to "running" with `startedAt` and `lastHeartbeatAt`
3. Load all project articles as `ArticleSummary[]` (no body text) [AAP-B7]
4. **Build `currentHashes` Map** from the loaded articles: `new Map(articles.map(a => [a.id, { bodyHash: a.bodyHash, titleHash: a.titleHash }]))` — required by `processEmbeddings()`
5. Get the embedding provider via `getProvider(projectId)`
6. Process embeddings via `processEmbeddings(projectId, articlesWithEmbedding, provider, currentHashes)` — store cache counters
7. For each article (or batch of articles): build `AnalysisContext` and run `registry.analyzeWithAll(context)`
   - **Update `lastHeartbeatAt`** on the AnalysisRun after each batch to signal liveness (prevents zombie recovery from killing legitimate long runs)
   - **Pre-check article existence** before analysis — if deleted mid-run, skip and increment `skippedArticleCount`
8. Provide `loadArticleBodies` callback that queries body text in batches via `prisma.article.findMany({ where: { id: { in: ids } }, select: { id: true, body: true } })`
9. Dedup and rank via `dedupAndRank()`
10. [AAP-B4] In a transaction: mark previous pending recs as `superseded` (same sourceArticleId + targetArticleId + strategyId triple), insert new recs
11. Handle FK violations gracefully [AAP-B10] — skip, log, continue. Track `skippedArticleCount`.
12. Transition to "completed" with counters (articleCount, recommendationCount, embeddingsCached, embeddingsGenerated)
13. On error: transition to "failed" with error message — no partial recommendations

Wrap the entire analysis in a try-catch that sets status to "failed" on any error.

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis/orchestrator.ts tests/lib/analysis/orchestrator.test.ts
git commit -m "feat(analysis): add orchestrator with chunked processing and embedding counters [AAP-B7, AAP-B4]"
```

---

## Task 9: POST /api/analyze Route

**Files:**
- Create: `src/app/api/analyze/route.ts`

- [ ] **Step 1: Implement the analyze route**

Behavior:
- Auth: `requireAuth()` → `projectId`
- Plan check: `checkPlanLimits(projectId, "analyze")` for free tier, `checkPlanLimits(projectId, "analyze_semantic")` if semantic enabled
- Validate: check articles exist (400 `NO_ARTICLES`), check no active run (409 `ANALYSIS_IN_PROGRESS` — enforced by AAP-B3 partial unique index)
- If `dryRun: true` [AAP-O8]: compute embedding estimate and return 200 without creating run
- Otherwise: create AnalysisRun (status: pending), fire on-demand cron trigger via `after()`, return 202

Key code patterns (from Phase 3):
- Use `after()` from `next/server` for on-demand cron trigger
- `scopedPrisma(projectId)` for tenant isolation
- zod validation for request body

- [ ] **Step 2: Commit**

```bash
git add src/app/api/analyze/route.ts
git commit -m "feat(analysis): add POST /api/analyze with dryRun support [AAP-O8]"
```

---

## Task 10: Analysis Cron Worker

**Files:**
- Create: `src/app/api/cron/analyze/route.ts`

- [ ] **Step 1: Implement the analysis cron worker**

Pattern follows the crawl cron from Phase 3.

**IMPORTANT:** The `/api/cron/analyze` entry already exists in `vercel.json` (daily schedule, 300s max). Do NOT add a new entry or change the schedule.

Steps:
1. Verify `CRON_SECRET` via `verifyCronSecret()`
2. [AAP-F4] Zombie recovery: find AnalysisRuns where status = 'running' AND `lastHeartbeatAt` (or `startedAt` if null) is older than 10 minutes → set "failed" with "Analysis timed out. Please try again."
3. Claim a pending AnalysisRun using `FOR UPDATE SKIP LOCKED` via raw SQL to prevent concurrent processing:
   ```sql
   SELECT id, "projectId" FROM "AnalysisRun"
   WHERE status = 'pending'
   ORDER BY "createdAt" ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED
   ```
   Then transition to "running" with `startedAt` and `lastHeartbeatAt`.
4. Call `processAnalysisRun(runId, projectId)` from orchestrator
5. Time budget: ~270s of the 300s max duration
6. Return JSON summary

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/analyze/route.ts
git commit -m "feat(analysis): add analysis cron worker with zombie recovery [AAP-F4]"
```

---

## Task 11: Runs API Routes

**Files:**
- Create: `src/app/api/runs/route.ts`
- Create: `src/app/api/runs/[id]/route.ts`
- Create: `src/app/api/runs/[id]/cancel/route.ts`

- [ ] **Step 1: Implement GET /api/runs (paginated list)**

```typescript
// Paginated list of AnalysisRun records for the project
// cursor-based pagination using id, sorted by createdAt desc
```

- [ ] **Step 2: Implement GET /api/runs/[id] (run detail)**

```typescript
// Full run detail with recommendation summary
// Include: recommendation counts by severity and status
```

- [ ] **Step 3: Implement POST /api/runs/[id]/cancel [AAP-F4]**

```typescript
// Set status to "cancelled"
// Return 200 with updated run
// Return 404 if not found
// Return 409 if already completed/failed
// Use Prisma error differentiation (P2025 for not found)
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/runs/route.ts" "src/app/api/runs/[id]/route.ts" "src/app/api/runs/[id]/cancel/route.ts"
git commit -m "feat(analysis): add runs list, detail, and cancel endpoints [AAP-F4]"
```

---

## Task 12: Full Test Suite & Type Check

- [ ] **Step 1: Run all tests**

Run: `npx vitest --run`

Expected: All tests pass including prior phases.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Run linter**

Run: `npm run lint`

- [ ] **Step 4: Fix any issues**
- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(analysis): address test/type/lint issues from full suite run"
```

---

## Task 13: Update build_log.md

- [ ] **Step 1: Append Phase 5 entry**

```markdown
## 2026-03-24 — Phase 5: Crosslink Strategy & Analysis

### Done
- SEOStrategy interface with ArticleSummary (no body text) [AAP-B7] and loadArticleBodies callback
- StrategyRegistry: register, unregister, getStrategy, analyzeWithAll
- CrosslinkStrategy: keyword matching (exact + Dice fuzzy), semantic matching (pgvector)
- 12 quality safeguards: self-link, existing link, noindex, error pages, max links, generic anchors, etc.
- Title prefix stripping and distinctive word coverage [AAP-O6]
- Conservative defaults for null existingLinks (assume 5) [AAP-O7]
- Dedup-ranker: merge keyword+semantic matches with +0.15 confidence boost, per-page cap
- Re-analysis scope: preserve accepted, skip dismissed if unchanged, supersede pending [AAP-B4]
- Analysis orchestrator: chunked async via cron, embedding processing, FK violation handling [AAP-B7/B10]
- POST /api/analyze: dryRun mode for cost estimation [AAP-O8], 202 Accepted, plan limit checks
- Analysis cron worker: zombie recovery (10 min threshold) [AAP-F4]
- Runs API: list, detail, cancel endpoints [AAP-F4]
- 31 new tests (crosslink 17 [15 keyword/quality + 2 semantic], registry 2, dedup 4, re-analysis 5, orchestrator 3)

### Decisions
- Crosslink strategy combines keyword and semantic in one class (not separate strategies)
- Semantic matching skipped when source article has no embedding
- On-demand cron trigger via after() — same pattern as Phase 3 crawl
- Orchestrator wraps recommendation save in transaction with superseding logic
- lastHeartbeatAt field prevents zombie recovery from killing legitimate long-running analyses
- AAP-B3 partial unique index prevents concurrent active analysis runs at the database level
- Anchor text sanitized against XSS from crawled article titles

### Next
- Phase 6: Recommendations UI & Export
```

- [ ] **Step 2: Commit**

```bash
git add build_log.md
git commit -m "docs(build-log): add Phase 5 crosslink strategy & analysis entry"
```
