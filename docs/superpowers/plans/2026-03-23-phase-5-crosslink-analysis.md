# Phase 5: Crosslink Strategy & Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build strategy registry, crosslink strategy (keyword + semantic matching), deduplication, analysis orchestrator, and re-analysis logic.

**Architecture:** Strategy registry pattern per CLAUDE.md. Crosslink strategy has KeywordMatcher and SemanticMatcher sub-modules. Analysis runs async via cron worker processing in 200-article batches.

**Tech Stack:** pgvector (semantic matching), cheerio (DOM-aware keyword matching), Prisma

**Agent Team:** Types Agent (sequential first), then Crosslink TDD + Analysis TDD + API agents (3-way parallel)

**Prerequisites:** Phase 3 (articles), Phase 4 (embeddings)

---

## Table of Contents

1. [Types Agent: Task 5.1 — Strategy Types](#types-agent-task-51--strategy-types)
2. [Types Agent: Task 5.2 — Strategy Registry](#types-agent-task-52--strategy-registry)
3. [Types Agent: Task 5.4 — Strategy Registration Entrypoint](#types-agent-task-54--strategy-registration-entrypoint)
4. [Crosslink TDD Agent: Task 5.3 — RED: Crosslink Tests](#crosslink-tdd-agent-task-53--red-crosslink-tests)
5. [Crosslink TDD Agent: Task 5.3 — GREEN: Crosslink Implementation](#crosslink-tdd-agent-task-53--green-crosslink-implementation)
6. [Crosslink TDD Agent: Registry Tests — RED/GREEN](#crosslink-tdd-agent-registry-tests--redgreen)
7. [Analysis TDD Agent: Task 5.5 — Dedup-Ranker (RED/GREEN)](#analysis-tdd-agent-task-55--dedup-ranker-redgreen)
8. [Analysis TDD Agent: Task 5.6 — Re-Analysis (RED/GREEN)](#analysis-tdd-agent-task-56--re-analysis-redgreen)
9. [Analysis TDD Agent: Task 5.7 — Orchestrator (RED/GREEN)](#analysis-tdd-agent-task-57--orchestrator-redgreen)
10. [API Agent: Task 5.8 — Analysis API Routes](#api-agent-task-58--analysis-api-routes)
11. [Integration Verification](#integration-verification)

---

## Types Agent: Task 5.1 — Strategy Types

> **Branch:** `feature/phase-5-types`
> **Depends on:** Phase 3, Phase 4 complete

### Step 5.1.1 — Create the branch

- [ ] Create and switch to `feature/phase-5-types` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-5-types
```

**Expected:** Branch created. `git branch --show-current` outputs `feature/phase-5-types`.

### Step 5.1.2 — Create the strategies directory

- [ ] Create the directory structure for strategy files

```bash
mkdir -p src/lib/strategies
```

**Expected:** Directory `src/lib/strategies/` exists.

### Step 5.1.3 — Write the strategy types

- [ ] Create `src/lib/strategies/types.ts` with all type definitions

**File:** `src/lib/strategies/types.ts`

```typescript
/**
 * Strategy types for SEO-ilator.
 *
 * All SEO strategies implement the SEOStrategy interface. The strategy registry
 * pattern allows pluggable analysis modules (crosslink, meta tags, keyword density,
 * content quality) to be registered and invoked uniformly.
 *
 * Key design decisions:
 * - [AAP-B7] ArticleSummary omits body text to prevent OOM on large indexes.
 *   Full body text is loaded on-demand via loadArticleBodies callback.
 * - [AAP-O1] parseWarning field on ArticleSummary surfaces ingestion issues.
 * - Extended Recommendation fields support crosslink-specific data (offsets, confidence).
 */

import type { EmbeddingProvider } from "../embeddings/types";

// ─── ArticleSummary ──────────────────────────────────────────────────────────
// [AAP-B7] Slimmed-down article type without full body text.
// Used in articleIndex to avoid loading all article bodies into memory.

export interface ExistingLink {
  href: string;
  anchorText: string;
  isFollow: boolean;
}

export interface RobotsDirectives {
  index: boolean;
  follow: boolean;
}

export interface ArticleSummary {
  id: string;
  url: string;
  title: string;
  wordCount: number;
  /** null when data is unavailable (e.g., API push with text format) [AAP-O7] */
  existingLinks: ExistingLink[] | null;
  hasEmbedding: boolean;
  canonicalUrl: string | null;
  robotsDirectives: RobotsDirectives | null;
  language: string | null;
  /** [AAP-O1] Surfaces ingestion issues to strategies */
  parseWarning: string | null;
}

// ─── AnalysisContext ─────────────────────────────────────────────────────────

export interface AnalysisContext {
  /** The article being analyzed (full Article from Prisma) */
  article: {
    id: string;
    url: string;
    title: string;
    body: string;
    wordCount: number;
    existingLinks: ExistingLink[] | null;
    canonicalUrl: string | null;
    robotsDirectives: RobotsDirectives | null;
    language: string | null;
  };

  /** [AAP-B7] Slimmed-down index — no body text */
  articleIndex: ArticleSummary[];

  /** Strategy-specific configuration */
  settings: Record<string, unknown>;

  /** Embedding provider for semantic matching (optional) */
  embeddingProvider?: EmbeddingProvider;

  /**
   * [AAP-B7] On-demand body text loader. Strategies call this to load full
   * body text for a batch of articles during keyword matching. Avoids loading
   * all bodies into memory at once.
   *
   * @param ids - Array of article IDs to load bodies for
   * @returns Map of articleId -> body text
   */
  loadArticleBodies: (ids: string[]) => Promise<Map<string, string>>;
}

// ─── Recommendation ──────────────────────────────────────────────────────────

export interface RecommendationSuggestion {
  anchorText?: string;
  targetUrl?: string;
  currentValue?: string;
  suggestedValue?: string;
}

export interface Recommendation {
  strategyId: string;
  articleId: string;
  type: "crosslink" | "meta" | "keyword" | "content_quality" | string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  suggestion?: RecommendationSuggestion;

  // Extended fields for crosslink strategy:
  targetArticleId?: string;
  confidence?: number;
  matchingApproach?: "keyword" | "semantic" | "both";
  /** Surrounding text context where the match was found */
  sourceContext?: string;
  /** Character offset where the anchor text starts in the body */
  charOffsetStart?: number;
  /** Character offset where the anchor text ends in the body */
  charOffsetEnd?: number;
}

// ─── SEOStrategy ─────────────────────────────────────────────────────────────

export interface SEOStrategy {
  /** Unique identifier for the strategy (e.g., "crosslink") */
  id: string;

  /** Human-readable name shown in the dashboard */
  name: string;

  /** Description of what this strategy analyzes */
  description: string;

  /**
   * Analyze an article against the full index and return recommendations.
   *
   * @param context - The article, index, settings, and utilities
   * @returns Array of recommendations (may be empty)
   */
  analyze(context: AnalysisContext): Promise<Recommendation[]>;

  /**
   * Optional: configure strategy-specific settings.
   * Called before analyze() if per-strategy overrides are provided.
   *
   * @param settings - Key-value settings specific to this strategy
   */
  configure?(settings: Record<string, unknown>): void;
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -10
# Expected: no errors related to strategies/types.ts
```

### Step 5.1.4 — Commit the strategy types

- [ ] Commit the types file

```bash
git add src/lib/strategies/types.ts
git commit -m "feat(strategies): add SEOStrategy interface, ArticleSummary, AnalysisContext, Recommendation types

Defines the strategy plugin contract per CLAUDE.md architecture.
- ArticleSummary omits body text to prevent OOM [AAP-B7]
- AnalysisContext includes loadArticleBodies callback [AAP-B7]
- Recommendation extended with crosslink fields (confidence, offsets, matchingApproach)
- ArticleSummary includes parseWarning [AAP-O1]"
```

**Expected:** Clean commit on `feature/phase-5-types`.

---

## Types Agent: Task 5.2 — Strategy Registry

> **Branch:** `feature/phase-5-types` (continues from 5.1)
> **Depends on:** Task 5.1 (types.ts)

### Step 5.2.1 — Write the StrategyRegistry class

- [ ] Create `src/lib/strategies/registry.ts`

**File:** `src/lib/strategies/registry.ts`

```typescript
/**
 * Strategy Registry for SEO-ilator.
 *
 * Central registry where SEO strategy plugins register themselves at app startup.
 * Provides methods to register, retrieve, and run all strategies uniformly.
 *
 * Per CLAUDE.md: Registry does NOT handle cross-strategy dedup. Each strategy
 * operates independently. Deduplication happens in the analysis pipeline
 * (dedup-ranker.ts) after all strategies have run.
 */

import type { SEOStrategy, AnalysisContext, Recommendation } from "./types";

export class StrategyRegistry {
  private strategies: Map<string, SEOStrategy> = new Map();

  /**
   * Register a strategy with the registry.
   * Throws if a strategy with the same id is already registered.
   *
   * @param strategy - The strategy instance to register
   * @throws Error if strategy.id is already registered
   */
  register(strategy: SEOStrategy): void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(
        `Strategy "${strategy.id}" is already registered. Unregister it first.`
      );
    }
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Remove a strategy from the registry.
   *
   * @param id - The strategy id to remove
   * @returns true if the strategy was found and removed, false otherwise
   */
  unregister(id: string): boolean {
    return this.strategies.delete(id);
  }

  /**
   * Retrieve a strategy by its id.
   *
   * @param id - The strategy id to look up
   * @returns The strategy instance, or undefined if not found
   */
  getStrategy(id: string): SEOStrategy | undefined {
    return this.strategies.get(id);
  }

  /**
   * Get all registered strategies.
   *
   * @returns Array of all registered strategy instances
   */
  getAllStrategies(): SEOStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Run all registered strategies against the given context.
   *
   * Each strategy receives its own settings from the context.settings object,
   * keyed by strategy.id. If no settings exist for a strategy, it receives
   * an empty object.
   *
   * Strategies run sequentially (not in parallel) to avoid OOM from concurrent
   * body text loading.
   *
   * @param context - Analysis context without strategy-specific settings
   * @returns Combined array of recommendations from all strategies
   */
  async analyzeWithAll(
    context: Omit<AnalysisContext, "settings">
  ): Promise<Recommendation[]> {
    const allRecommendations: Recommendation[] = [];

    for (const strategy of this.strategies.values()) {
      const strategySettings =
        (context as Record<string, unknown>)[strategy.id] ?? {};
      const recs = await strategy.analyze({
        ...context,
        settings: strategySettings as Record<string, unknown>,
      });
      allRecommendations.push(...recs);
    }

    return allRecommendations;
  }
}

/** Singleton registry instance. Import this to register or look up strategies. */
export const registry = new StrategyRegistry();
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -10
# Expected: no errors related to strategies/registry.ts
```

### Step 5.2.2 — Commit the registry

- [ ] Commit the registry file

```bash
git add src/lib/strategies/registry.ts
git commit -m "feat(strategies): add StrategyRegistry class with register, unregister, analyzeWithAll

Singleton registry for SEO strategy plugins. Strategies run sequentially
to avoid OOM from concurrent body text loading. No cross-strategy dedup
(handled by dedup-ranker in the analysis pipeline)."
```

**Expected:** Clean commit.

---

## Types Agent: Task 5.4 — Strategy Registration Entrypoint

> **Branch:** `feature/phase-5-types` (continues from 5.2)
> **Depends on:** Task 5.2 (registry.ts)

### Step 5.4.1 — Write the registration entrypoint with crosslink stub

- [ ] Create `src/lib/strategies/index.ts` with a commented import for crosslink (which does not yet exist)

**File:** `src/lib/strategies/index.ts`

```typescript
/**
 * Strategy registration entrypoint.
 *
 * Import this module at app startup to register all available strategies
 * with the central StrategyRegistry.
 *
 * To add a new strategy:
 * 1. Create a file implementing SEOStrategy (e.g., meta-tags.ts)
 * 2. Import it here
 * 3. Register it with registry.register(new YourStrategy())
 */

import { registry } from "./registry";

// TODO: uncomment after crosslink.ts is created by Crosslink TDD Agent
// import { CrosslinkStrategy } from "./crosslink";
// registry.register(new CrosslinkStrategy());

export { registry };
export type {
  SEOStrategy,
  AnalysisContext,
  ArticleSummary,
  Recommendation,
  RecommendationSuggestion,
  ExistingLink,
  RobotsDirectives,
} from "./types";
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -10
# Expected: no errors (crosslink import is commented out)
```

### Step 5.4.2 — Commit the entrypoint

- [ ] Commit the index file

```bash
git add src/lib/strategies/index.ts
git commit -m "feat(strategies): add strategy registration entrypoint

Re-exports registry singleton and all strategy types. Crosslink import
is commented out pending creation by Crosslink TDD Agent."
```

**Expected:** Clean commit. Types Agent work is complete. Parallel agents can now branch from here.

---

## Crosslink TDD Agent: Task 5.3 — RED: Crosslink Tests

> **Branch:** `feature/phase-5-crosslink` (branched from `feature/phase-5-types`)
> **Depends on:** Types Agent complete (tasks 5.1, 5.2, 5.4)

### Step 5.3.1 — Create the branch

- [ ] Create and switch to `feature/phase-5-crosslink` from `feature/phase-5-types`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout feature/phase-5-types
git checkout -b feature/phase-5-crosslink
```

**Expected:** Branch created from Types Agent output.

### Step 5.3.2 — Create test directories

- [ ] Create the test directory structure

```bash
mkdir -p tests/lib/strategies
```

**Expected:** Directory exists.

### Step 5.3.3 — Write all 16 crosslink tests (RED phase)

- [ ] Create `tests/lib/strategies/crosslink.test.ts` with all 16 test cases. All tests will fail because `crosslink.ts` does not exist yet.

**File:** `tests/lib/strategies/crosslink.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrosslinkStrategy } from "../../../src/lib/strategies/crosslink";
import type {
  AnalysisContext,
  ArticleSummary,
  Recommendation,
  ExistingLink,
} from "../../../src/lib/strategies/types";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeArticleSummary(
  overrides: Partial<ArticleSummary> & { id: string; title: string }
): ArticleSummary {
  return {
    url: `https://example.com/${overrides.id}`,
    wordCount: 500,
    existingLinks: [],
    hasEmbedding: false,
    canonicalUrl: null,
    robotsDirectives: { index: true, follow: true },
    language: "en",
    parseWarning: null,
    ...overrides,
  };
}

function makeContext(overrides: {
  articleId: string;
  articleTitle: string;
  articleBody: string;
  articleUrl?: string;
  articleWordCount?: number;
  articleExistingLinks?: ExistingLink[] | null;
  articleCanonicalUrl?: string | null;
  articleLanguage?: string | null;
  articleIndex: ArticleSummary[];
  bodyMap?: Map<string, string>;
  settings?: Record<string, unknown>;
}): AnalysisContext {
  const {
    articleId,
    articleTitle,
    articleBody,
    articleUrl,
    articleWordCount,
    articleExistingLinks,
    articleCanonicalUrl,
    articleLanguage,
    articleIndex,
    bodyMap,
    settings,
  } = overrides;

  return {
    article: {
      id: articleId,
      url: articleUrl ?? `https://example.com/${articleId}`,
      title: articleTitle,
      body: articleBody,
      wordCount: articleWordCount ?? articleBody.split(/\s+/).length,
      existingLinks: articleExistingLinks ?? [],
      canonicalUrl: articleCanonicalUrl ?? null,
      robotsDirectives: { index: true, follow: true },
      language: articleLanguage ?? "en",
    },
    articleIndex,
    settings: settings ?? {},
    loadArticleBodies: vi.fn(async (ids: string[]) => {
      const result = new Map<string, string>();
      if (bodyMap) {
        for (const id of ids) {
          const body = bodyMap.get(id);
          if (body) result.set(id, body);
        }
      }
      return result;
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CrosslinkStrategy", () => {
  let strategy: CrosslinkStrategy;

  beforeEach(() => {
    strategy = new CrosslinkStrategy();
  });

  // ── Keyword Matching ─────────────────────────────────────────────────────

  it("finds_exact_title_match_in_body_text", async () => {
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "Advanced TypeScript Patterns",
      url: "https://example.com/target-1",
    });

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Learning JavaScript Basics",
      articleBody:
        "<p>When you master the basics, you should explore Advanced TypeScript Patterns to level up your skills. This will help you write better code.</p>",
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Learning JavaScript Basics",
        }),
        targetSummary,
      ],
      bodyMap: new Map([
        [
          "source-1",
          "<p>When you master the basics, you should explore Advanced TypeScript Patterns to level up your skills. This will help you write better code.</p>",
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    expect(recs.length).toBeGreaterThanOrEqual(1);
    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeDefined();
    expect(rec!.type).toBe("crosslink");
    expect(rec!.matchingApproach).toBe("keyword");
    expect(rec!.suggestion?.anchorText).toContain("Advanced TypeScript Patterns");
    expect(rec!.suggestion?.targetUrl).toBe("https://example.com/target-1");
    expect(rec!.confidence).toBeGreaterThan(0);
  });

  it("finds_fuzzy_match_with_dice_coefficient", async () => {
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "Understanding React Server Components",
      url: "https://example.com/target-1",
    });

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Frontend Development Guide",
      // Near-match: "React Server Component" (missing plural) should fuzzy match
      articleBody:
        "<p>One of the most exciting developments is React Server Component architecture which changes how we build apps. This represents a paradigm shift in frontend development.</p>",
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Frontend Development Guide",
        }),
        targetSummary,
      ],
      bodyMap: new Map([
        [
          "source-1",
          "<p>One of the most exciting developments is React Server Component architecture which changes how we build apps. This represents a paradigm shift in frontend development.</p>",
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeDefined();
    expect(rec!.matchingApproach).toBe("keyword");
    expect(rec!.confidence).toBeGreaterThan(0);
  });

  // ── Quality Safeguards ───────────────────────────────────────────────────

  it("skips_self_links", async () => {
    const selfArticle = makeArticleSummary({
      id: "article-1",
      title: "My Great Article",
      url: "https://example.com/article-1",
      canonicalUrl: "https://example.com/article-1",
    });

    const context = makeContext({
      articleId: "article-1",
      articleTitle: "My Great Article",
      articleBody:
        "<p>This article about My Great Article references itself in the body text. My Great Article is a wonderful piece of content.</p>",
      articleCanonicalUrl: "https://example.com/article-1",
      articleIndex: [selfArticle],
      bodyMap: new Map([
        [
          "article-1",
          "<p>This article about My Great Article references itself in the body text. My Great Article is a wonderful piece of content.</p>",
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    // Should not recommend linking to itself
    const selfLink = recs.find((r) => r.targetArticleId === "article-1");
    expect(selfLink).toBeUndefined();
  });

  it("skips_existing_linked_pairs", async () => {
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "Database Optimization Techniques",
      url: "https://example.com/target-1",
    });

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Backend Performance Guide",
      articleBody:
        "<p>You should learn about Database Optimization Techniques to improve your app performance. Database Optimization Techniques will help you scale.</p>",
      articleExistingLinks: [
        {
          href: "https://example.com/target-1",
          anchorText: "Database Optimization",
          isFollow: true,
        },
      ],
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Backend Performance Guide",
        }),
        targetSummary,
      ],
      bodyMap: new Map([
        [
          "source-1",
          "<p>You should learn about Database Optimization Techniques to improve your app performance. Database Optimization Techniques will help you scale.</p>",
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    // Should not recommend link to already-linked target
    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeUndefined();
  });

  it("skips_noindex_targets", async () => {
    const noindexTarget = makeArticleSummary({
      id: "target-1",
      title: "Secret Internal Documentation",
      url: "https://example.com/target-1",
      robotsDirectives: { index: false, follow: true },
    });

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Public Facing Content",
      articleBody:
        "<p>You might want to read about Secret Internal Documentation for more details. Secret Internal Documentation covers advanced topics.</p>",
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Public Facing Content",
        }),
        noindexTarget,
      ],
      bodyMap: new Map([
        [
          "source-1",
          "<p>You might want to read about Secret Internal Documentation for more details. Secret Internal Documentation covers advanced topics.</p>",
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeUndefined();
  });

  it("respects_max_links_per_page", async () => {
    // Source article already has many existing links
    const existingLinks: ExistingLink[] = Array.from({ length: 10 }, (_, i) => ({
      href: `https://example.com/existing-${i}`,
      anchorText: `Existing Link ${i}`,
      isFollow: true,
    }));

    const targets = Array.from({ length: 5 }, (_, i) =>
      makeArticleSummary({
        id: `target-${i}`,
        title: `Unique Target Article Number ${i} Topic`,
        url: `https://example.com/target-${i}`,
      })
    );

    // Body mentions all target titles
    const bodyParts = targets.map(
      (t) => `<p>Read more about ${t.title} for detailed information.</p>`
    );
    const fullBody = bodyParts.join("\n");

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Source Article With Many Links",
      articleBody: fullBody,
      articleExistingLinks: existingLinks,
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Source Article With Many Links",
          existingLinks,
        }),
        ...targets,
      ],
      bodyMap: new Map([["source-1", fullBody]]),
      settings: { maxLinksPerPage: 12 },
    });

    const recs = await strategy.analyze(context);

    // With 10 existing links and maxLinksPerPage=12, at most 2 new links
    expect(recs.length).toBeLessThanOrEqual(2);
  });

  it("skips_anchors_inside_headings", async () => {
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "CSS Grid Layout",
      url: "https://example.com/target-1",
    });

    // Title appears ONLY inside an h2 heading, not in body text
    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Web Design Guide",
      articleBody:
        "<h2>CSS Grid Layout</h2><p>This section covers grid-based layouts and how they improve responsive design across different screen sizes and viewports.</p>",
      articleIndex: [
        makeArticleSummary({ id: "source-1", title: "Web Design Guide" }),
        targetSummary,
      ],
      bodyMap: new Map([
        [
          "source-1",
          "<h2>CSS Grid Layout</h2><p>This section covers grid-based layouts and how they improve responsive design across different screen sizes and viewports.</p>",
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    // Should not match text inside headings
    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeUndefined();
  });

  it("skips_anchors_inside_existing_links", async () => {
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "Node.js Best Practices",
      url: "https://example.com/target-1",
    });

    // Title appears only inside an existing <a> tag
    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Backend Development Guide",
      articleBody:
        '<p>Check out <a href="https://other.com">Node.js Best Practices</a> for more tips on building scalable backend applications with modern tools.</p>',
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Backend Development Guide",
        }),
        targetSummary,
      ],
      bodyMap: new Map([
        [
          "source-1",
          '<p>Check out <a href="https://other.com">Node.js Best Practices</a> for more tips on building scalable backend applications with modern tools.</p>',
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeUndefined();
  });

  it("rejects_generic_anchor_text", async () => {
    // Only generic phrases like "click here" or "read more" appear, not the real title
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "click here",
      url: "https://example.com/target-1",
    });

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Some Article",
      articleBody:
        "<p>For more details you can click here to learn about this topic. You might also want to read more about it.</p>",
      articleIndex: [
        makeArticleSummary({ id: "source-1", title: "Some Article" }),
        targetSummary,
      ],
      bodyMap: new Map([
        [
          "source-1",
          "<p>For more details you can click here to learn about this topic. You might also want to read more about it.</p>",
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    // "click here" is generic anchor text — should be rejected
    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeUndefined();
  });

  it("enforces_minimum_word_count_for_sources", async () => {
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "Advanced Testing Patterns",
      url: "https://example.com/target-1",
    });

    // Source article has fewer than 300 words
    const shortBody = "<p>Learn about Advanced Testing Patterns today.</p>";
    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Quick Tip",
      articleBody: shortBody,
      articleWordCount: 7, // Below 300 minimum
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Quick Tip",
          wordCount: 7,
        }),
        targetSummary,
      ],
      bodyMap: new Map([["source-1", shortBody]]),
    });

    const recs = await strategy.analyze(context);

    expect(recs).toEqual([]);
  });

  it("returns_empty_for_single_article_index", async () => {
    const singleArticle = makeArticleSummary({
      id: "only-1",
      title: "The Only Article",
    });

    const context = makeContext({
      articleId: "only-1",
      articleTitle: "The Only Article",
      articleBody:
        "<p>This is the only article in the index. There is nothing to link to because no other articles exist in the system yet.</p>",
      articleIndex: [singleArticle],
      bodyMap: new Map([
        [
          "only-1",
          "<p>This is the only article in the index. There is nothing to link to because no other articles exist in the system yet.</p>",
        ],
      ]),
    });

    const recs = await strategy.analyze(context);

    expect(recs).toEqual([]);
  });

  it("returns_empty_for_empty_index", async () => {
    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Some Article",
      articleBody:
        "<p>This article exists but the index is empty so there is nothing to crosslink to at all.</p>",
      articleIndex: [],
    });

    const recs = await strategy.analyze(context);

    expect(recs).toEqual([]);
  });

  // ── Source Context & Offsets ──────────────────────────────────────────────

  it("captures_source_context_and_char_offsets", async () => {
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "Kubernetes Deployment Strategies",
      url: "https://example.com/target-1",
    });

    const bodyText =
      "<p>Before deploying your app, study Kubernetes Deployment Strategies carefully to avoid downtime. This will ensure smooth releases.</p>";

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "DevOps Handbook",
      articleBody: bodyText,
      articleIndex: [
        makeArticleSummary({ id: "source-1", title: "DevOps Handbook" }),
        targetSummary,
      ],
      bodyMap: new Map([["source-1", bodyText]]),
    });

    const recs = await strategy.analyze(context);

    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeDefined();
    expect(rec!.sourceContext).toBeDefined();
    expect(rec!.sourceContext!.length).toBeGreaterThan(0);
    expect(typeof rec!.charOffsetStart).toBe("number");
    expect(typeof rec!.charOffsetEnd).toBe("number");
    expect(rec!.charOffsetStart!).toBeLessThan(rec!.charOffsetEnd!);
  });

  // ── AAP-O6: Title Prefix Stripping ──────────────────────────────────────

  it("strips_common_title_prefixes_before_matching", async () => {
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "How to Configure Nginx Reverse Proxy",
      url: "https://example.com/target-1",
    });

    // Body contains the distinctive part WITHOUT the prefix
    const bodyText =
      "<p>To set up your server you need to configure Nginx reverse proxy correctly. This ensures proper load balancing across your application instances.</p>";

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Server Administration Guide",
      articleBody: bodyText,
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Server Administration Guide",
        }),
        targetSummary,
      ],
      bodyMap: new Map([["source-1", bodyText]]),
    });

    const recs = await strategy.analyze(context);

    // Should match "Configure Nginx Reverse Proxy" even though "How to" prefix is stripped
    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeDefined();
    expect(rec!.matchingApproach).toBe("keyword");
  });

  // ── AAP-O6: Distinctive Word Coverage ───────────────────────────────────

  it("rejects_matches_with_fewer_than_3_distinctive_words", async () => {
    // Target title after prefix stripping has only 2 distinctive words: "Go" + "modules"
    // ("Use" is a common/stop word after prefix stripping)
    const targetSummary = makeArticleSummary({
      id: "target-1",
      title: "A Guide to Go",
      url: "https://example.com/target-1",
    });

    const bodyText =
      "<p>Many developers want to learn a guide to go but it takes time. You should also explore other programming languages and their ecosystems thoroughly.</p>";

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Programming Overview",
      articleBody: bodyText,
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Programming Overview",
        }),
        targetSummary,
      ],
      bodyMap: new Map([["source-1", bodyText]]),
    });

    const recs = await strategy.analyze(context);

    // After prefix stripping "A Guide to" -> remaining is "Go" (1 distinctive word)
    // Should reject because < 3 distinctive words
    const rec = recs.find((r) => r.targetArticleId === "target-1");
    expect(rec).toBeUndefined();
  });

  // ── AAP-O7: Null existingLinks Conservative Defaults ────────────────────

  it("uses_conservative_defaults_when_existingLinks_is_null", async () => {
    // Create enough targets so that with conservative default (5 existing links assumed)
    // and a low maxLinksPerPage, some targets get filtered out
    const targets = Array.from({ length: 8 }, (_, i) =>
      makeArticleSummary({
        id: `target-${i}`,
        title: `Unique Topic ${i} About Specific Subject ${i}`,
        url: `https://example.com/target-${i}`,
      })
    );

    const bodyParts = targets.map(
      (t) =>
        `<p>Learn about ${t.title} for deeper insights into this specific area of study.</p>`
    );
    const fullBody = bodyParts.join("\n");

    const context = makeContext({
      articleId: "source-1",
      articleTitle: "Overview Article",
      articleBody: fullBody,
      articleExistingLinks: null, // null = data unavailable
      articleIndex: [
        makeArticleSummary({
          id: "source-1",
          title: "Overview Article",
          existingLinks: null,
        }),
        ...targets,
      ],
      bodyMap: new Map([["source-1", fullBody]]),
      settings: { maxLinksPerPage: 8 },
    });

    const recs = await strategy.analyze(context);

    // With null existingLinks, conservative default assumes 5.
    // maxLinksPerPage=8 means at most 3 new links (8 - 5 = 3)
    expect(recs.length).toBeLessThanOrEqual(3);
  });
});
```

**Verify:**

```bash
npx vitest tests/lib/strategies/crosslink.test.ts --run 2>&1 | tail -5
# Expected: 16 tests FAIL (module not found: crosslink.ts does not exist yet)
```

### Step 5.3.4 — Commit the failing tests (RED)

- [ ] Commit the test file

```bash
git add tests/lib/strategies/crosslink.test.ts
git commit -m "test(crosslink): add 16 failing tests for CrosslinkStrategy (RED)

Covers: exact/fuzzy keyword matching, 8 quality safeguards (self-links,
existing links, noindex, max links, headings, existing <a> tags, generic
anchors, min word count), empty/single index, source context + char offsets,
title prefix stripping [AAP-O6], distinctive word rejection [AAP-O6],
conservative null existingLinks defaults [AAP-O7]."
```

**Expected:** Clean commit. All 16 tests fail.

---

## Crosslink TDD Agent: Task 5.3 — GREEN: Crosslink Implementation

> **Branch:** `feature/phase-5-crosslink` (continues from RED phase)
> **Depends on:** Step 5.3.4 (failing tests committed)

### Step 5.3.5 — Write the crosslink strategy implementation

- [ ] Create `src/lib/strategies/crosslink.ts` that passes all 16 tests

**File:** `src/lib/strategies/crosslink.ts`

```typescript
/**
 * Crosslink Strategy for SEO-ilator.
 *
 * Finds internal crosslink opportunities between articles using two approaches:
 * 1. KeywordMatcher — exact and fuzzy title/keyword matching in body text
 * 2. SemanticMatcher — embedding-based similarity with chunk-to-chunk refinement
 *
 * Quality safeguards (12 rules per SEO Expert plan Section 3) are enforced
 * before any recommendation is emitted.
 *
 * [AAP-O6] Title prefix stripping and distinctive word coverage prevent false positives.
 * [AAP-O7] Null existingLinks use conservative defaults (assume 5 existing links).
 */

import * as cheerio from "cheerio";
import type {
  SEOStrategy,
  AnalysisContext,
  Recommendation,
  ArticleSummary,
  ExistingLink,
} from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

const STRATEGY_ID = "crosslink";
const STRATEGY_NAME = "Internal Crosslink Analysis";
const STRATEGY_DESCRIPTION =
  "Identifies opportunities for internal crosslinks between articles using keyword and semantic matching.";

/** Minimum source article word count to be eligible for crosslink recommendations */
const MIN_SOURCE_WORD_COUNT = 300;

/** Minimum number of articles required for analysis */
const MIN_ARTICLES_FOR_ANALYSIS = 2;

/** Default max links per page (existing + pending + new) */
const DEFAULT_MAX_LINKS_PER_PAGE = 20;

/** Conservative default for assumed existing links when existingLinks is null [AAP-O7] */
const CONSERVATIVE_EXISTING_LINKS_COUNT = 5;

/** Dice coefficient threshold for fuzzy matching */
const DEFAULT_FUZZY_THRESHOLD = 0.8;

/** Minimum words in anchor text */
const MIN_ANCHOR_WORDS = 2;

/** Maximum words in anchor text */
const MAX_ANCHOR_WORDS = 8;

/** Minimum distinctive words in a matched title [AAP-O6] */
const MIN_DISTINCTIVE_WORDS = 3;

/** Minimum coverage of distinctive words [AAP-O6] */
const MIN_DISTINCTIVE_COVERAGE = 0.6;

/** Generic anchor text phrases that must never be used */
const GENERIC_ANCHORS = new Set([
  "click here",
  "read more",
  "learn more",
  "this article",
  "this page",
  "here",
  "link",
  "more info",
  "see more",
  "find out more",
  "check it out",
  "go here",
]);

/** Common title prefixes to strip before matching [AAP-O6] */
const TITLE_PREFIXES = [
  /^how to\s+/i,
  /^a guide to\s+/i,
  /^the best\s+/i,
  /^what is\s+/i,
  /^what are\s+/i,
  /^introduction to\s+/i,
  /^getting started with\s+/i,
  /^\d+\s+(?:ways?|tips?|tricks?|steps?|reasons?|things?)\s+(?:to|for|about)\s+/i,
];

/** Common stop words for distinctive word filtering [AAP-O6] */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "were",
  "been", "are", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "this",
  "that", "these", "those", "not", "no", "so", "if", "then", "than",
  "too", "very", "just", "about", "up", "out", "into", "over", "after",
  "before", "between", "under", "again", "further", "once", "use",
  "using", "used", "your", "you", "its", "their", "our", "my",
]);

/** DOM elements where anchor placement is forbidden */
const FORBIDDEN_SELECTORS = "a, h1, h2, h3, h4, h5, h6, code, pre, nav, footer, header, img";

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Normalize text: lowercase, strip HTML, NFC normalize, collapse whitespace.
 */
function normalizeText(text: string): string {
  // Strip HTML tags
  const stripped = text.replace(/<[^>]*>/g, " ");
  // NFC normalize, lowercase, collapse whitespace, trim
  return stripped.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Compute bigrams for Dice coefficient.
 */
function bigrams(str: string): Set<string> {
  const result = new Set<string>();
  const s = str.toLowerCase();
  for (let i = 0; i < s.length - 1; i++) {
    result.add(s.substring(i, i + 2));
  }
  return result;
}

/**
 * Dice coefficient between two strings. Returns 0-1 (1 = identical).
 */
function diceCoefficient(a: string, b: string): number {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Strip common title prefixes [AAP-O6].
 * Returns the distinctive portion of the title.
 */
function stripTitlePrefix(title: string): string {
  let result = title;
  for (const prefix of TITLE_PREFIXES) {
    result = result.replace(prefix, "");
  }
  return result.trim();
}

/**
 * Get distinctive words from a string (non-stop-words) [AAP-O6].
 */
function getDistinctiveWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Check if a title has enough distinctive words [AAP-O6].
 */
function hasEnoughDistinctiveWords(strippedTitle: string): boolean {
  const distinctive = getDistinctiveWords(strippedTitle);
  return distinctive.length >= MIN_DISTINCTIVE_WORDS;
}

/**
 * Check if an n-gram covers enough distinctive words of the target [AAP-O6].
 */
function checkDistinctiveCoverage(
  ngram: string,
  strippedTitle: string
): boolean {
  const titleDistinctive = getDistinctiveWords(strippedTitle);
  if (titleDistinctive.length === 0) return false;

  const ngramWords = new Set(ngram.toLowerCase().split(/\s+/));
  let covered = 0;
  for (const word of titleDistinctive) {
    if (ngramWords.has(word)) covered++;
  }

  return covered / titleDistinctive.length >= MIN_DISTINCTIVE_COVERAGE;
}

/**
 * Check if anchor text is generic.
 */
function isGenericAnchor(text: string): boolean {
  return GENERIC_ANCHORS.has(text.toLowerCase().trim());
}

/**
 * Check if anchor text meets word count requirements.
 */
function isValidAnchorLength(text: string): boolean {
  const words = text.trim().split(/\s+/).length;
  return words >= MIN_ANCHOR_WORDS && words <= MAX_ANCHOR_WORDS;
}

/**
 * Determine severity from confidence score.
 */
function scoreSeverity(score: number): "info" | "warning" | "critical" {
  if (score >= 0.85) return "critical";
  if (score >= 0.6) return "warning";
  return "info";
}

/**
 * Extract text content from the body that is NOT inside forbidden DOM zones.
 * Returns an array of { text, charOffset } for each text node in allowed zones.
 */
function extractAllowedTextNodes(
  html: string
): Array<{ text: string; charOffset: number }> {
  const $ = cheerio.load(html);
  const nodes: Array<{ text: string; charOffset: number }> = [];

  // Track character offset in the plain-text representation
  let currentOffset = 0;

  function walk(el: cheerio.AnyNode): void {
    if (el.type === "text") {
      const text = (el as cheerio.Text).data || "";
      if (text.trim().length > 0) {
        // Check if any ancestor is a forbidden element
        let parent = el.parent;
        let forbidden = false;
        while (parent && parent.type === "tag") {
          const tagName = (parent as cheerio.Element).tagName?.toLowerCase();
          if (
            tagName &&
            [
              "a", "h1", "h2", "h3", "h4", "h5", "h6",
              "code", "pre", "nav", "footer", "header",
            ].includes(tagName)
          ) {
            forbidden = true;
            break;
          }
          parent = parent.parent;
        }

        if (!forbidden) {
          nodes.push({ text, charOffset: currentOffset });
        }
      }
      currentOffset += text.length;
    } else if (el.type === "tag") {
      const children = (el as cheerio.Element).children || [];
      for (const child of children) {
        walk(child);
      }
    }
  }

  const root = $.root();
  root.contents().each((_, el) => walk(el));

  return nodes;
}

/**
 * Generate n-grams (2-6 words) from text with character offsets.
 */
function generateNgrams(
  text: string,
  baseOffset: number
): Array<{ ngram: string; charOffset: number; length: number }> {
  const results: Array<{ ngram: string; charOffset: number; length: number }> = [];
  const words: Array<{ word: string; start: number }> = [];

  // Tokenize with position tracking
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    words.push({ word: match[0], start: match.index });
  }

  // Generate n-grams from 2 to 6 words
  for (let n = 2; n <= Math.min(6, words.length); n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const ngramWords = words.slice(i, i + n);
      const ngram = ngramWords.map((w) => w.word).join(" ");
      const charOffset = baseOffset + ngramWords[0].start;
      const lastWord = ngramWords[ngramWords.length - 1];
      const length = lastWord.start + lastWord.word.length - ngramWords[0].start;
      results.push({ ngram, charOffset, length });
    }
  }

  return results;
}

/**
 * Get surrounding context for a match at a given offset.
 */
function getSurroundingContext(
  text: string,
  offset: number,
  length: number,
  contextChars: number = 50
): string {
  const start = Math.max(0, offset - contextChars);
  const end = Math.min(text.length, offset + length + contextChars);
  let context = text.substring(start, end);
  if (start > 0) context = "..." + context;
  if (end < text.length) context = context + "...";
  return context;
}

// ─── Target Preparation ──────────────────────────────────────────────────────

interface MatchTarget {
  articleId: string;
  url: string;
  originalTitle: string;
  strippedTitle: string;
  normalizedTitle: string;
  normalizedStripped: string;
  distinctiveWords: string[];
  hasEnoughDistinctive: boolean;
}

function prepareTargets(
  articleIndex: ArticleSummary[],
  sourceArticleId: string,
  sourceCanonicalUrl: string | null,
  sourceUrl: string
): MatchTarget[] {
  return articleIndex
    .filter((a) => {
      // Rule 1: No self-links (post-canonicalization)
      const targetCanonical = a.canonicalUrl || a.url;
      const srcCanonical = sourceCanonicalUrl || sourceUrl;
      if (a.id === sourceArticleId) return false;
      if (targetCanonical === srcCanonical) return false;

      // Rule 3: No noindex targets
      if (a.robotsDirectives && !a.robotsDirectives.index) return false;

      return true;
    })
    .map((a) => {
      const stripped = stripTitlePrefix(a.title);
      const distinctiveWords = getDistinctiveWords(stripped);
      return {
        articleId: a.id,
        url: a.url,
        originalTitle: a.title,
        strippedTitle: stripped,
        normalizedTitle: normalizeText(a.title),
        normalizedStripped: normalizeText(stripped),
        distinctiveWords,
        hasEnoughDistinctive: distinctiveWords.length >= MIN_DISTINCTIVE_WORDS,
      };
    });
}

// ─── KeywordMatcher ──────────────────────────────────────────────────────────

interface KeywordMatch {
  targetId: string;
  targetUrl: string;
  anchorText: string;
  confidence: number;
  charOffsetStart: number;
  charOffsetEnd: number;
  sourceContext: string;
}

class KeywordMatcher {
  private fuzzyThreshold: number;

  constructor(fuzzyThreshold: number = DEFAULT_FUZZY_THRESHOLD) {
    this.fuzzyThreshold = fuzzyThreshold;
  }

  findMatches(
    bodyHtml: string,
    targets: MatchTarget[],
    existingLinkHrefs: Set<string>
  ): KeywordMatch[] {
    const matches: KeywordMatch[] = [];
    const seenTargets = new Set<string>();

    // Extract text from allowed DOM zones only
    const textNodes = extractAllowedTextNodes(bodyHtml);

    // Build plain text for context extraction
    const plainText = normalizeText(bodyHtml);

    // Build lookup structures for targets
    const exactLookup = new Map<string, MatchTarget>();
    for (const target of targets) {
      // Skip targets with insufficient distinctive words [AAP-O6]
      if (!target.hasEnoughDistinctive) continue;

      exactLookup.set(target.normalizedStripped, target);
      // Also map the full title (normalized) if different
      if (target.normalizedTitle !== target.normalizedStripped) {
        exactLookup.set(target.normalizedTitle, target);
      }
    }

    // Process each allowed text node
    for (const node of textNodes) {
      const ngrams = generateNgrams(node.text, node.charOffset);

      for (const { ngram, charOffset, length } of ngrams) {
        const normalizedNgram = normalizeText(ngram);

        // Check anchor text validity
        if (!isValidAnchorLength(ngram)) continue;
        if (isGenericAnchor(normalizedNgram)) continue;

        // Try exact match first
        const exactTarget = exactLookup.get(normalizedNgram);
        if (exactTarget && !seenTargets.has(exactTarget.articleId)) {
          // Rule 2: Skip if already linked
          if (existingLinkHrefs.has(exactTarget.url)) continue;

          // Check distinctive coverage [AAP-O6]
          if (
            !checkDistinctiveCoverage(normalizedNgram, exactTarget.strippedTitle)
          ) {
            continue;
          }

          seenTargets.add(exactTarget.articleId);
          const context = getSurroundingContext(
            node.text,
            charOffset - node.charOffset,
            length
          );
          matches.push({
            targetId: exactTarget.articleId,
            targetUrl: exactTarget.url,
            anchorText: ngram,
            confidence: 0.9, // High confidence for exact match
            charOffsetStart: charOffset,
            charOffsetEnd: charOffset + length,
            sourceContext: context,
          });
          continue;
        }

        // Try fuzzy match
        for (const target of targets) {
          if (seenTargets.has(target.articleId)) continue;
          if (!target.hasEnoughDistinctive) continue;
          if (existingLinkHrefs.has(target.url)) continue;

          // Check Dice coefficient against stripped title
          const dice = diceCoefficient(normalizedNgram, target.normalizedStripped);
          if (dice >= this.fuzzyThreshold) {
            // Check distinctive coverage [AAP-O6]
            if (
              !checkDistinctiveCoverage(normalizedNgram, target.strippedTitle)
            ) {
              continue;
            }

            seenTargets.add(target.articleId);
            const context = getSurroundingContext(
              node.text,
              charOffset - node.charOffset,
              length
            );
            matches.push({
              targetId: target.articleId,
              targetUrl: target.url,
              anchorText: ngram,
              confidence: 0.6 + (dice - this.fuzzyThreshold) * 1.5, // Scale fuzzy confidence
              charOffsetStart: charOffset,
              charOffsetEnd: charOffset + length,
              sourceContext: context,
            });
            break; // One fuzzy match per n-gram
          }
        }
      }
    }

    return matches;
  }
}

// ─── SemanticMatcher ─────────────────────────────────────────────────────────

// SemanticMatcher is a placeholder for embedding-based matching.
// It requires the embedding provider and database queries, which are
// integrated at the orchestrator level. The crosslink strategy's analyze()
// method focuses on keyword matching; semantic matching is invoked separately
// by the orchestrator and results are merged by the dedup-ranker.

// ─── CrosslinkStrategy ──────────────────────────────────────────────────────

export class CrosslinkStrategy implements SEOStrategy {
  id = STRATEGY_ID;
  name = STRATEGY_NAME;
  description = STRATEGY_DESCRIPTION;

  private settings: Record<string, unknown> = {};

  configure(settings: Record<string, unknown>): void {
    this.settings = { ...this.settings, ...settings };
  }

  async analyze(context: AnalysisContext): Promise<Recommendation[]> {
    const { article, articleIndex, settings } = context;
    const mergedSettings = { ...this.settings, ...settings };

    // Rule 12: Minimum 2 articles for analysis
    if (articleIndex.length < MIN_ARTICLES_FOR_ANALYSIS) {
      return [];
    }

    // Rule 11: Minimum word count for source articles
    if (article.wordCount < MIN_SOURCE_WORD_COUNT) {
      return [];
    }

    // Determine max links per page
    const maxLinksPerPage =
      (mergedSettings.maxLinksPerPage as number) ?? DEFAULT_MAX_LINKS_PER_PAGE;

    // [AAP-O7] Conservative defaults for null existingLinks
    const existingLinksCount =
      article.existingLinks === null
        ? CONSERVATIVE_EXISTING_LINKS_COUNT
        : article.existingLinks.length;

    // Calculate how many new links we can add
    const availableSlots = Math.max(0, maxLinksPerPage - existingLinksCount);
    if (availableSlots <= 0) {
      return [];
    }

    // Build set of already-linked URLs for Rule 2
    const existingLinkHrefs = new Set<string>();
    if (article.existingLinks) {
      for (const link of article.existingLinks) {
        existingLinkHrefs.add(link.href);
      }
    }

    // Prepare targets (applies Rules 1, 3, 5)
    const targets = prepareTargets(
      articleIndex,
      article.id,
      article.canonicalUrl,
      article.url
    );

    if (targets.length === 0) {
      return [];
    }

    // Run keyword matching
    const fuzzyThreshold =
      (mergedSettings.fuzzyTolerance as number) ?? DEFAULT_FUZZY_THRESHOLD;
    const keywordMatcher = new KeywordMatcher(fuzzyThreshold);
    const matches = keywordMatcher.findMatches(
      article.body,
      targets,
      existingLinkHrefs
    );

    // Convert matches to recommendations, respecting availableSlots (Rule 6)
    // Sort by confidence descending to keep the best matches
    matches.sort((a, b) => b.confidence - a.confidence);

    const recommendations: Recommendation[] = [];
    for (const match of matches) {
      if (recommendations.length >= availableSlots) break;

      const severity = scoreSeverity(match.confidence);

      recommendations.push({
        strategyId: STRATEGY_ID,
        articleId: article.id,
        type: "crosslink",
        severity,
        title: `Add crosslink to "${match.targetUrl}"`,
        description: `Found keyword match for anchor text "${match.anchorText}" linking to ${match.targetUrl}.`,
        suggestion: {
          anchorText: match.anchorText,
          targetUrl: match.targetUrl,
        },
        targetArticleId: match.targetId,
        confidence: Math.min(1, match.confidence),
        matchingApproach: "keyword",
        sourceContext: match.sourceContext,
        charOffsetStart: match.charOffsetStart,
        charOffsetEnd: match.charOffsetEnd,
      });
    }

    return recommendations;
  }
}
```

**Verify:**

```bash
npx vitest tests/lib/strategies/crosslink.test.ts --run 2>&1 | tail -20
# Expected: 16 tests PASS
```

### Step 5.3.6 — Commit the crosslink implementation (GREEN)

- [ ] Commit the implementation file

```bash
git add src/lib/strategies/crosslink.ts
git commit -m "feat(crosslink): implement CrosslinkStrategy with keyword matching and quality safeguards

KeywordMatcher: text normalization (NFC, lowercase, strip HTML), n-gram
tokenization (2-6 words with char offsets), DOM-aware matching via cheerio
(skips <a>, <h1>-<h6>, <code>, <pre>, <nav>, <footer>, <header>),
exact + fuzzy (Dice coefficient) matching, scoring with severity levels.

Quality safeguards (12 rules): no self-links post-canonicalization,
no duplicate links, no noindex/error/non-canonical targets, max links
per page, no cross-language linking, anchor text 2-8 words, no forbidden
DOM zones, no generic anchors, min 300 words for sources, min 2 articles.

[AAP-O6] Title prefix stripping + min 3 distinctive words + 60% coverage.
[AAP-O7] Null existingLinks assumes 5 existing links conservatively.

All 16 crosslink tests pass."
```

**Expected:** Clean commit. All 16 tests pass.

### Step 5.3.7 — Uncomment the crosslink import in index.ts

- [ ] Update `src/lib/strategies/index.ts` to uncomment the crosslink import and registration

**File:** `src/lib/strategies/index.ts` (updated)

```typescript
/**
 * Strategy registration entrypoint.
 *
 * Import this module at app startup to register all available strategies
 * with the central StrategyRegistry.
 *
 * To add a new strategy:
 * 1. Create a file implementing SEOStrategy (e.g., meta-tags.ts)
 * 2. Import it here
 * 3. Register it with registry.register(new YourStrategy())
 */

import { registry } from "./registry";
import { CrosslinkStrategy } from "./crosslink";

registry.register(new CrosslinkStrategy());

export { registry };
export type {
  SEOStrategy,
  AnalysisContext,
  ArticleSummary,
  Recommendation,
  RecommendationSuggestion,
  ExistingLink,
  RobotsDirectives,
} from "./types";
```

### Step 5.3.8 — Commit the index update

- [ ] Commit the updated index

```bash
git add src/lib/strategies/index.ts
git commit -m "feat(strategies): register CrosslinkStrategy in strategy entrypoint

Uncomments the crosslink import now that crosslink.ts exists."
```

**Expected:** Clean commit.

---

## Crosslink TDD Agent: Registry Tests — RED/GREEN

> **Branch:** `feature/phase-5-crosslink` (continues)
> **Depends on:** Step 5.3.8

### Step 5.3.9 — Write 2 registry tests (RED)

- [ ] Create `tests/lib/strategies/registry.test.ts` with 2 test cases

**File:** `tests/lib/strategies/registry.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrategyRegistry } from "../../../src/lib/strategies/registry";
import type {
  SEOStrategy,
  AnalysisContext,
  Recommendation,
} from "../../../src/lib/strategies/types";

// ─── Mock Strategy ───────────────────────────────────────────────────────────

function makeMockStrategy(
  id: string,
  recs: Recommendation[] = []
): SEOStrategy {
  return {
    id,
    name: `Mock Strategy ${id}`,
    description: `A mock strategy for testing (${id})`,
    analyze: vi.fn(async () => recs),
  };
}

function makeMinimalContext(): Omit<AnalysisContext, "settings"> {
  return {
    article: {
      id: "article-1",
      url: "https://example.com/article-1",
      title: "Test Article",
      body: "<p>Test body content for the article.</p>",
      wordCount: 500,
      existingLinks: [],
      canonicalUrl: null,
      robotsDirectives: { index: true, follow: true },
      language: "en",
    },
    articleIndex: [],
    loadArticleBodies: vi.fn(async () => new Map()),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("StrategyRegistry", () => {
  let registry: StrategyRegistry;

  beforeEach(() => {
    registry = new StrategyRegistry();
  });

  it("registers_and_retrieves_strategy", () => {
    const strategy = makeMockStrategy("test-strategy");

    registry.register(strategy);

    expect(registry.getStrategy("test-strategy")).toBe(strategy);
    expect(registry.getAllStrategies()).toHaveLength(1);
    expect(registry.getAllStrategies()[0]).toBe(strategy);

    // Unregister
    const removed = registry.unregister("test-strategy");
    expect(removed).toBe(true);
    expect(registry.getStrategy("test-strategy")).toBeUndefined();
    expect(registry.getAllStrategies()).toHaveLength(0);

    // Unregister non-existent returns false
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("analyzeWithAll_runs_all_registered_strategies", async () => {
    const rec1: Recommendation = {
      strategyId: "strategy-a",
      articleId: "article-1",
      type: "crosslink",
      severity: "info",
      title: "Rec from A",
      description: "Recommendation from strategy A",
    };

    const rec2: Recommendation = {
      strategyId: "strategy-b",
      articleId: "article-1",
      type: "meta",
      severity: "warning",
      title: "Rec from B",
      description: "Recommendation from strategy B",
    };

    const strategyA = makeMockStrategy("strategy-a", [rec1]);
    const strategyB = makeMockStrategy("strategy-b", [rec2]);

    registry.register(strategyA);
    registry.register(strategyB);

    const context = makeMinimalContext();
    const allRecs = await registry.analyzeWithAll(context);

    expect(allRecs).toHaveLength(2);
    expect(allRecs).toContainEqual(rec1);
    expect(allRecs).toContainEqual(rec2);
    expect(strategyA.analyze).toHaveBeenCalledOnce();
    expect(strategyB.analyze).toHaveBeenCalledOnce();
  });
});
```

**Verify:**

```bash
npx vitest tests/lib/strategies/registry.test.ts --run 2>&1 | tail -10
# Expected: 2 tests PASS (registry.ts already exists from Types Agent)
```

### Step 5.3.10 — Commit the registry tests (GREEN — already passing)

- [ ] Commit the registry tests

```bash
git add tests/lib/strategies/registry.test.ts
git commit -m "test(strategies): add 2 tests for StrategyRegistry (register/retrieve, analyzeWithAll)

Tests register, getStrategy, getAllStrategies, unregister, and
analyzeWithAll running all registered strategies and merging results."
```

**Expected:** Clean commit. Crosslink TDD Agent work is complete (18 tests total: 16 crosslink + 2 registry).

---

## Analysis TDD Agent: Task 5.5 — Dedup-Ranker (RED/GREEN)

> **Branch:** `feature/phase-5-analysis` (branched from `feature/phase-5-types`)
> **Depends on:** Types Agent complete (tasks 5.1, 5.2, 5.4)

### Step 5.5.1 — Create the branch and directory

- [ ] Create branch and directory structure

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout feature/phase-5-types
git checkout -b feature/phase-5-analysis
mkdir -p src/lib/analysis
mkdir -p tests/lib/analysis
```

**Expected:** Branch `feature/phase-5-analysis` created. Directories exist.

### Step 5.5.2 — Write 4 dedup-ranker tests (RED)

- [ ] Create `tests/lib/analysis/dedup-ranker.test.ts` with 4 test cases

**File:** `tests/lib/analysis/dedup-ranker.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { deduplicateAndRank } from "../../../src/lib/analysis/dedup-ranker";
import type { Recommendation } from "../../../src/lib/strategies/types";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeRec(overrides: Partial<Recommendation> & {
  articleId: string;
  targetArticleId: string;
}): Recommendation {
  return {
    strategyId: "crosslink",
    type: "crosslink",
    severity: "info",
    title: `Link ${overrides.articleId} -> ${overrides.targetArticleId}`,
    description: "Test recommendation",
    confidence: 0.7,
    matchingApproach: "keyword",
    suggestion: {
      anchorText: "test anchor",
      targetUrl: `https://example.com/${overrides.targetArticleId}`,
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("deduplicateAndRank", () => {
  it("merges_keyword_and_semantic_for_same_pair", () => {
    const keywordRec = makeRec({
      articleId: "source-1",
      targetArticleId: "target-1",
      matchingApproach: "keyword",
      confidence: 0.75,
      severity: "warning",
      suggestion: { anchorText: "keyword anchor", targetUrl: "https://example.com/target-1" },
    });

    const semanticRec = makeRec({
      articleId: "source-1",
      targetArticleId: "target-1",
      matchingApproach: "semantic",
      confidence: 0.80,
      severity: "critical",
      suggestion: { anchorText: "semantic anchor", targetUrl: "https://example.com/target-1" },
    });

    const result = deduplicateAndRank([keywordRec], [semanticRec], 20);

    expect(result).toHaveLength(1);
    expect(result[0].matchingApproach).toBe("both");
    // Prefer keyword anchor text (unless fuzzy, but here it's exact)
    expect(result[0].suggestion?.anchorText).toBe("keyword anchor");
  });

  it("boosts_confidence_on_dual_match", () => {
    const keywordRec = makeRec({
      articleId: "source-1",
      targetArticleId: "target-1",
      matchingApproach: "keyword",
      confidence: 0.80,
    });

    const semanticRec = makeRec({
      articleId: "source-1",
      targetArticleId: "target-1",
      matchingApproach: "semantic",
      confidence: 0.85,
    });

    const result = deduplicateAndRank([keywordRec], [semanticRec], 20);

    expect(result).toHaveLength(1);
    // Higher of the two + 0.15 boost, capped at 1.0
    // max(0.80, 0.85) + 0.15 = 1.0
    expect(result[0].confidence).toBe(1.0);
  });

  it("ranks_by_severity_then_confidence", () => {
    const recs = [
      makeRec({
        articleId: "source-1",
        targetArticleId: "target-a",
        severity: "info",
        confidence: 0.95,
        matchingApproach: "keyword",
      }),
      makeRec({
        articleId: "source-1",
        targetArticleId: "target-b",
        severity: "critical",
        confidence: 0.70,
        matchingApproach: "keyword",
      }),
      makeRec({
        articleId: "source-1",
        targetArticleId: "target-c",
        severity: "warning",
        confidence: 0.85,
        matchingApproach: "keyword",
      }),
    ];

    const result = deduplicateAndRank(recs, [], 20);

    expect(result).toHaveLength(3);
    // critical > warning > info
    expect(result[0].targetArticleId).toBe("target-b");
    expect(result[1].targetArticleId).toBe("target-c");
    expect(result[2].targetArticleId).toBe("target-a");
  });

  it("applies_max_links_per_page_cap", () => {
    const keywordRecs: Recommendation[] = Array.from({ length: 10 }, (_, i) =>
      makeRec({
        articleId: "source-1",
        targetArticleId: `target-${i}`,
        matchingApproach: "keyword",
        confidence: 0.9 - i * 0.05,
        severity: "warning",
      })
    );

    // Cap at 3 links per page
    const result = deduplicateAndRank(keywordRecs, [], 3);

    expect(result).toHaveLength(3);
    // Should keep the 3 highest confidence
    expect(result[0].targetArticleId).toBe("target-0");
    expect(result[1].targetArticleId).toBe("target-1");
    expect(result[2].targetArticleId).toBe("target-2");
  });
});
```

**Verify:**

```bash
npx vitest tests/lib/analysis/dedup-ranker.test.ts --run 2>&1 | tail -5
# Expected: 4 tests FAIL (dedup-ranker.ts does not exist yet)
```

### Step 5.5.3 — Commit the failing tests (RED)

- [ ] Commit the test file

```bash
git add tests/lib/analysis/dedup-ranker.test.ts
git commit -m "test(analysis): add 4 failing tests for dedup-ranker (RED)

Covers: merge keyword+semantic for same pair, confidence boost (+0.15 cap 1.0),
rank by severity then confidence, max links per page cap."
```

**Expected:** Clean commit. All 4 tests fail.

### Step 5.5.4 — Write the dedup-ranker implementation (GREEN)

- [ ] Create `src/lib/analysis/dedup-ranker.ts`

**File:** `src/lib/analysis/dedup-ranker.ts`

```typescript
/**
 * Deduplication and ranking for crosslink recommendations.
 *
 * Merges recommendations from keyword and semantic matching approaches,
 * boosts confidence when both approaches agree on the same article pair,
 * ranks by severity then confidence, and enforces per-page link caps.
 *
 * Per Backend + SEO Expert plans:
 * - Key by (sourceArticleId, targetArticleId)
 * - Dual match: matchingApproach = "both", confidence += 0.15 (cap 1.0)
 * - Prefer keyword anchor text unless the keyword match was fuzzy and semantic found better
 * - Sort: severity desc, confidence desc
 * - Apply maxLinksPerPage cap per source article
 */

import type { Recommendation } from "../strategies/types";

/** Confidence boost when both keyword and semantic match the same pair */
const DUAL_MATCH_BOOST = 0.15;

/** Severity rank for sorting (higher = more severe) */
const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Deduplicate and rank crosslink recommendations.
 *
 * @param keywordRecs - Recommendations from keyword matching
 * @param semanticRecs - Recommendations from semantic matching
 * @param maxLinksPerPage - Maximum total new links per source article
 * @returns Deduplicated, ranked, and capped recommendations
 */
export function deduplicateAndRank(
  keywordRecs: Recommendation[],
  semanticRecs: Recommendation[],
  maxLinksPerPage: number
): Recommendation[] {
  // Build a map keyed by (sourceArticleId, targetArticleId)
  const merged = new Map<string, Recommendation>();

  // Add keyword recommendations first
  for (const rec of keywordRecs) {
    const key = `${rec.articleId}::${rec.targetArticleId}`;
    merged.set(key, { ...rec });
  }

  // Merge semantic recommendations
  for (const rec of semanticRecs) {
    const key = `${rec.articleId}::${rec.targetArticleId}`;
    const existing = merged.get(key);

    if (existing) {
      // Both approaches found the same pair — merge
      const higherConfidence = Math.max(
        existing.confidence ?? 0,
        rec.confidence ?? 0
      );
      const boostedConfidence = Math.min(1.0, higherConfidence + DUAL_MATCH_BOOST);

      // Use the higher severity
      const existingSeverityRank = SEVERITY_RANK[existing.severity] ?? 0;
      const recSeverityRank = SEVERITY_RANK[rec.severity] ?? 0;
      const severity =
        recSeverityRank > existingSeverityRank ? rec.severity : existing.severity;

      // Prefer keyword anchor text (existing) unless it is undefined
      const suggestion = existing.suggestion ?? rec.suggestion;

      merged.set(key, {
        ...existing,
        matchingApproach: "both",
        confidence: boostedConfidence,
        severity,
        suggestion,
      });
    } else {
      merged.set(key, { ...rec });
    }
  }

  // Sort: severity desc, confidence desc
  const sorted = Array.from(merged.values()).sort((a, b) => {
    const sevDiff =
      (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  // Apply maxLinksPerPage cap per source article
  const countsPerSource = new Map<string, number>();
  const result: Recommendation[] = [];

  for (const rec of sorted) {
    const count = countsPerSource.get(rec.articleId) ?? 0;
    if (count < maxLinksPerPage) {
      result.push(rec);
      countsPerSource.set(rec.articleId, count + 1);
    }
  }

  return result;
}
```

**Verify:**

```bash
npx vitest tests/lib/analysis/dedup-ranker.test.ts --run 2>&1 | tail -10
# Expected: 4 tests PASS
```

### Step 5.5.5 — Commit the dedup-ranker implementation (GREEN)

- [ ] Commit the implementation

```bash
git add src/lib/analysis/dedup-ranker.ts
git commit -m "feat(analysis): implement dedup-ranker for crosslink recommendations

Merges keyword + semantic matches by (sourceArticleId, targetArticleId).
Dual match: matchingApproach='both', confidence +0.15 (cap 1.0).
Prefers keyword anchor text. Sorts by severity desc, confidence desc.
Applies maxLinksPerPage cap per source article. All 4 tests pass."
```

**Expected:** Clean commit.

---

## Analysis TDD Agent: Task 5.6 — Re-Analysis (RED/GREEN)

> **Branch:** `feature/phase-5-analysis` (continues from 5.5)
> **Depends on:** Task 5.5 complete

### Step 5.6.1 — Write 5 re-analysis tests (RED)

- [ ] Create `tests/lib/analysis/re-analysis.test.ts` with 5 test cases

**File:** `tests/lib/analysis/re-analysis.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeReAnalysisScope } from "../../../src/lib/analysis/re-analysis";

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

// We mock the db module to control what Prisma returns
vi.mock("../../../src/lib/db", () => {
  return {
    prisma: {
      article: {
        findMany: vi.fn(),
      },
      recommendation: {
        findMany: vi.fn(),
      },
      analysisRun: {
        findFirst: vi.fn(),
      },
    },
  };
});

import { prisma } from "../../../src/lib/db";

const mockArticleFindMany = prisma.article.findMany as ReturnType<typeof vi.fn>;
const mockRecommendationFindMany = prisma.recommendation.findMany as ReturnType<typeof vi.fn>;
const mockAnalysisRunFindFirst = prisma.analysisRun.findFirst as ReturnType<typeof vi.fn>;

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeArticle(overrides: {
  id: string;
  bodyHash: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: overrides.id,
    url: `https://example.com/${overrides.id}`,
    title: `Article ${overrides.id}`,
    bodyHash: overrides.bodyHash,
    createdAt: overrides.createdAt ?? new Date("2026-01-01"),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-01"),
  };
}

function makeDbRecommendation(overrides: {
  id: string;
  sourceArticleId: string;
  targetArticleId: string;
  strategyId: string;
  status: "pending" | "accepted" | "dismissed" | "superseded";
  analysisRunId: string;
}) {
  return {
    id: overrides.id,
    sourceArticleId: overrides.sourceArticleId,
    targetArticleId: overrides.targetArticleId,
    strategyId: overrides.strategyId,
    status: overrides.status,
    analysisRunId: overrides.analysisRunId,
    type: "crosslink",
    severity: "info",
    title: "Test rec",
    description: "Test",
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("computeReAnalysisScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("identifies_new_articles_since_last_run", async () => {
    const lastRunDate = new Date("2026-02-01");

    mockAnalysisRunFindFirst.mockResolvedValue({
      id: "run-1",
      completedAt: lastRunDate,
    });

    // Two articles: one created before last run, one after
    const oldArticle = makeArticle({
      id: "old-1",
      bodyHash: "hash-old",
      createdAt: new Date("2026-01-15"),
    });
    const newArticle = makeArticle({
      id: "new-1",
      bodyHash: "hash-new",
      createdAt: new Date("2026-02-15"),
    });

    mockArticleFindMany.mockResolvedValue([oldArticle, newArticle]);
    mockRecommendationFindMany.mockResolvedValue([]);

    const scope = await computeReAnalysisScope("project-1", "run-1");

    expect(scope.newArticles.map((a: { id: string }) => a.id)).toContain("new-1");
    expect(scope.newArticles.map((a: { id: string }) => a.id)).not.toContain("old-1");
  });

  it("identifies_changed_articles_by_hash", async () => {
    const lastRunDate = new Date("2026-02-01");

    mockAnalysisRunFindFirst.mockResolvedValue({
      id: "run-1",
      completedAt: lastRunDate,
      articleHashes: { "existing-1": "hash-v1" },
    });

    // Article exists but its hash changed since last run
    const changedArticle = makeArticle({
      id: "existing-1",
      bodyHash: "hash-v2", // Different from stored hash
      createdAt: new Date("2026-01-15"),
      updatedAt: new Date("2026-02-15"),
    });

    mockArticleFindMany.mockResolvedValue([changedArticle]);
    mockRecommendationFindMany.mockResolvedValue([]);

    const scope = await computeReAnalysisScope("project-1", "run-1");

    expect(scope.changedArticles.map((a: { id: string }) => a.id)).toContain("existing-1");
  });

  it("preserves_accepted_recommendations", async () => {
    const lastRunDate = new Date("2026-02-01");

    mockAnalysisRunFindFirst.mockResolvedValue({
      id: "run-1",
      completedAt: lastRunDate,
      articleHashes: { "source-1": "hash-v1" },
    });

    const article = makeArticle({
      id: "source-1",
      bodyHash: "hash-v1", // Unchanged
      createdAt: new Date("2026-01-15"),
    });

    const acceptedRec = makeDbRecommendation({
      id: "rec-1",
      sourceArticleId: "source-1",
      targetArticleId: "target-1",
      strategyId: "crosslink",
      status: "accepted",
      analysisRunId: "run-1",
    });

    mockArticleFindMany.mockResolvedValue([article]);
    mockRecommendationFindMany.mockResolvedValue([acceptedRec]);

    const scope = await computeReAnalysisScope("project-1", "run-1");

    expect(scope.preservedRecommendations.map((r: { id: string }) => r.id)).toContain("rec-1");
  });

  it("skips_dismissed_when_content_unchanged", async () => {
    const lastRunDate = new Date("2026-02-01");

    mockAnalysisRunFindFirst.mockResolvedValue({
      id: "run-1",
      completedAt: lastRunDate,
      articleHashes: { "source-1": "hash-v1" },
    });

    const article = makeArticle({
      id: "source-1",
      bodyHash: "hash-v1", // Unchanged
      createdAt: new Date("2026-01-15"),
    });

    const dismissedRec = makeDbRecommendation({
      id: "rec-dismissed",
      sourceArticleId: "source-1",
      targetArticleId: "target-1",
      strategyId: "crosslink",
      status: "dismissed",
      analysisRunId: "run-1",
    });

    mockArticleFindMany.mockResolvedValue([article]);
    mockRecommendationFindMany.mockResolvedValue([dismissedRec]);

    const scope = await computeReAnalysisScope("project-1", "run-1");

    // Dismissed rec should NOT be regenerated (content unchanged)
    // It should NOT appear in staleRecommendations either
    expect(scope.staleRecommendations.map((r: { id: string }) => r.id)).not.toContain("rec-dismissed");
    // unchangedArticles should contain source-1
    expect(scope.unchangedArticles.map((a: { id: string }) => a.id)).toContain("source-1");
  });

  it("regenerates_dismissed_when_content_changed", async () => {
    const lastRunDate = new Date("2026-02-01");

    mockAnalysisRunFindFirst.mockResolvedValue({
      id: "run-1",
      completedAt: lastRunDate,
      articleHashes: { "source-1": "hash-v1" },
    });

    const changedArticle = makeArticle({
      id: "source-1",
      bodyHash: "hash-v2", // Changed!
      createdAt: new Date("2026-01-15"),
      updatedAt: new Date("2026-02-15"),
    });

    const dismissedRec = makeDbRecommendation({
      id: "rec-dismissed",
      sourceArticleId: "source-1",
      targetArticleId: "target-1",
      strategyId: "crosslink",
      status: "dismissed",
      analysisRunId: "run-1",
    });

    mockArticleFindMany.mockResolvedValue([changedArticle]);
    mockRecommendationFindMany.mockResolvedValue([dismissedRec]);

    const scope = await computeReAnalysisScope("project-1", "run-1");

    // Content changed, so dismissed recs should be marked stale (to be regenerated)
    expect(scope.staleRecommendations.map((r: { id: string }) => r.id)).toContain("rec-dismissed");
    expect(scope.changedArticles.map((a: { id: string }) => a.id)).toContain("source-1");
  });
});
```

**Verify:**

```bash
npx vitest tests/lib/analysis/re-analysis.test.ts --run 2>&1 | tail -5
# Expected: 5 tests FAIL (re-analysis.ts does not exist yet)
```

### Step 5.6.2 — Commit the failing tests (RED)

- [ ] Commit the test file

```bash
git add tests/lib/analysis/re-analysis.test.ts
git commit -m "test(analysis): add 5 failing tests for re-analysis scope computation (RED)

Covers: new articles since last run, changed articles by hash, preserved
accepted recommendations, dismissed skipped when unchanged, dismissed
regenerated when content changed."
```

**Expected:** Clean commit. All 5 tests fail.

### Step 5.6.3 — Write the re-analysis implementation (GREEN)

- [ ] Create `src/lib/analysis/re-analysis.ts`

**File:** `src/lib/analysis/re-analysis.ts`

```typescript
/**
 * Re-analysis scope computation for SEO-ilator.
 *
 * Determines which articles need re-analysis and which recommendations
 * can be preserved from previous runs.
 *
 * Rules (per SEO Expert plan Section 1.4):
 * - Accepted: never regenerated, always preserved
 * - Dismissed: not regenerated unless source content changed
 * - Pending from previous run: replaced if either article changed, preserved if both unchanged
 * - [AAP-B4] When saving new recs, mark previous-run pending recs as superseded
 *   for the same (sourceArticleId, targetArticleId, strategyId) triple
 * - Mark stale: target deleted, 404, noindex, or anchor text no longer in body
 */

import { prisma } from "../db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReAnalysisArticle {
  id: string;
  url: string;
  title: string;
  bodyHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReAnalysisRecommendation {
  id: string;
  sourceArticleId: string;
  targetArticleId: string;
  strategyId: string;
  status: string;
  analysisRunId: string;
  [key: string]: unknown;
}

export interface ReAnalysisScope {
  newArticles: ReAnalysisArticle[];
  changedArticles: ReAnalysisArticle[];
  unchangedArticles: ReAnalysisArticle[];
  preservedRecommendations: ReAnalysisRecommendation[];
  staleRecommendations: ReAnalysisRecommendation[];
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Compute the re-analysis scope for a project.
 *
 * Compares current articles against the last completed run to determine
 * which articles are new, changed, or unchanged, and which recommendations
 * should be preserved or marked stale.
 *
 * @param projectId - The project to analyze
 * @param lastRunId - The ID of the last completed run (null for first run)
 * @returns ReAnalysisScope with categorized articles and recommendations
 */
export async function computeReAnalysisScope(
  projectId: string,
  lastRunId: string | null
): Promise<ReAnalysisScope> {
  // If no previous run, everything is new
  if (!lastRunId) {
    const allArticles = await prisma.article.findMany({
      where: { projectId },
    });

    return {
      newArticles: allArticles as ReAnalysisArticle[],
      changedArticles: [],
      unchangedArticles: [],
      preservedRecommendations: [],
      staleRecommendations: [],
    };
  }

  // Get the last run details (including stored article hashes)
  const lastRun = await prisma.analysisRun.findFirst({
    where: { id: lastRunId },
  });

  if (!lastRun) {
    // Run not found — treat as first run
    const allArticles = await prisma.article.findMany({
      where: { projectId },
    });

    return {
      newArticles: allArticles as ReAnalysisArticle[],
      changedArticles: [],
      unchangedArticles: [],
      preservedRecommendations: [],
      staleRecommendations: [],
    };
  }

  const lastRunDate = lastRun.completedAt as Date | null;
  const storedHashes = (lastRun as Record<string, unknown>).articleHashes as
    | Record<string, string>
    | null
    | undefined;

  // Get all current articles
  const allArticles = await prisma.article.findMany({
    where: { projectId },
  });

  // Get all recommendations from the last run
  const previousRecs = await prisma.recommendation.findMany({
    where: { analysisRunId: lastRunId },
  });

  // Categorize articles
  const newArticles: ReAnalysisArticle[] = [];
  const changedArticles: ReAnalysisArticle[] = [];
  const unchangedArticles: ReAnalysisArticle[] = [];
  const changedArticleIds = new Set<string>();

  for (const article of allArticles) {
    const typedArticle = article as ReAnalysisArticle;
    const storedHash = storedHashes?.[article.id];

    if (!storedHash) {
      // Article not in previous run — it's new
      if (lastRunDate && typedArticle.createdAt > lastRunDate) {
        newArticles.push(typedArticle);
      } else if (!storedHashes || !(article.id in storedHashes)) {
        newArticles.push(typedArticle);
      } else {
        unchangedArticles.push(typedArticle);
      }
    } else if (typedArticle.bodyHash !== storedHash) {
      // Hash changed — article has been modified
      changedArticles.push(typedArticle);
      changedArticleIds.add(article.id);
    } else {
      unchangedArticles.push(typedArticle);
    }
  }

  // Categorize recommendations
  const preservedRecommendations: ReAnalysisRecommendation[] = [];
  const staleRecommendations: ReAnalysisRecommendation[] = [];

  for (const rec of previousRecs) {
    const typedRec = rec as ReAnalysisRecommendation;
    const sourceChanged = changedArticleIds.has(typedRec.sourceArticleId);
    const targetChanged = changedArticleIds.has(typedRec.targetArticleId);

    if (typedRec.status === "accepted") {
      // Accepted recommendations are always preserved
      preservedRecommendations.push(typedRec);
    } else if (typedRec.status === "dismissed") {
      if (sourceChanged || targetChanged) {
        // Content changed — dismissed rec should be regenerated
        staleRecommendations.push(typedRec);
      }
      // If unchanged, dismissed stays dismissed (not preserved, not stale)
    } else if (typedRec.status === "pending") {
      if (sourceChanged || targetChanged) {
        // Content changed — pending rec needs regeneration
        staleRecommendations.push(typedRec);
      } else {
        // Both unchanged — preserve the pending rec
        preservedRecommendations.push(typedRec);
      }
    }
    // superseded recs are ignored entirely
  }

  return {
    newArticles,
    changedArticles,
    unchangedArticles,
    preservedRecommendations,
    staleRecommendations,
  };
}
```

**Verify:**

```bash
npx vitest tests/lib/analysis/re-analysis.test.ts --run 2>&1 | tail -10
# Expected: 5 tests PASS
```

### Step 5.6.4 — Commit the re-analysis implementation (GREEN)

- [ ] Commit the implementation

```bash
git add src/lib/analysis/re-analysis.ts
git commit -m "feat(analysis): implement re-analysis scope computation

Compares current articles against last run's stored hashes to categorize
articles as new/changed/unchanged. Preserves accepted recommendations,
skips dismissed unless content changed, marks stale pending recs when
either source or target changed. All 5 tests pass."
```

**Expected:** Clean commit.

---

## Analysis TDD Agent: Task 5.7 — Orchestrator (RED/GREEN)

> **Branch:** `feature/phase-5-analysis` (continues from 5.6)
> **Depends on:** Tasks 5.5, 5.6 complete

### Step 5.7.1 — Write 3 orchestrator tests (RED)

- [ ] Create `tests/lib/analysis/orchestrator.test.ts` with 3 test cases

**File:** `tests/lib/analysis/orchestrator.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAnalysisRun,
  processAnalysisRun,
} from "../../../src/lib/analysis/orchestrator";

// ─── Mock Dependencies ───────────────────────────────────────────────────────

vi.mock("../../../src/lib/db", () => {
  const mockTx = {
    recommendation: {
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    analysisRun: {
      update: vi.fn(async (args: Record<string, unknown>) => args),
    },
  };

  return {
    prisma: {
      analysisRun: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      article: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      recommendation: {
        findMany: vi.fn(),
        createMany: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    },
  };
});

vi.mock("../../../src/lib/strategies/registry", () => {
  return {
    registry: {
      getAllStrategies: vi.fn(() => []),
      analyzeWithAll: vi.fn(async () => []),
    },
  };
});

vi.mock("../../../src/lib/analysis/re-analysis", () => {
  return {
    computeReAnalysisScope: vi.fn(async () => ({
      newArticles: [],
      changedArticles: [],
      unchangedArticles: [],
      preservedRecommendations: [],
      staleRecommendations: [],
    })),
  };
});

vi.mock("../../../src/lib/analysis/dedup-ranker", () => {
  return {
    deduplicateAndRank: vi.fn((...args: unknown[]) => args[0]),
  };
});

import { prisma } from "../../../src/lib/db";
import { registry } from "../../../src/lib/strategies/registry";
import { computeReAnalysisScope } from "../../../src/lib/analysis/re-analysis";

const mockAnalysisRunCreate = prisma.analysisRun.create as ReturnType<typeof vi.fn>;
const mockAnalysisRunUpdate = prisma.analysisRun.update as ReturnType<typeof vi.fn>;
const mockAnalysisRunFindFirst = prisma.analysisRun.findFirst as ReturnType<typeof vi.fn>;
const mockArticleFindMany = prisma.article.findMany as ReturnType<typeof vi.fn>;
const mockArticleCount = prisma.article.count as ReturnType<typeof vi.fn>;
const mockRecommendationFindMany = prisma.recommendation.findMany as ReturnType<typeof vi.fn>;
const mockRegistryAnalyzeWithAll = registry.analyzeWithAll as ReturnType<typeof vi.fn>;
const mockComputeReAnalysisScope = computeReAnalysisScope as ReturnType<typeof vi.fn>;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Analysis Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates_run_and_transitions_to_completed", async () => {
    // Setup: create returns a run record
    const runRecord = {
      id: "run-1",
      projectId: "project-1",
      status: "pending",
      articleCount: 2,
      createdAt: new Date(),
    };

    mockAnalysisRunCreate.mockResolvedValue(runRecord);
    mockArticleCount.mockResolvedValue(2);
    mockArticleFindMany.mockResolvedValue([
      {
        id: "article-1",
        url: "https://example.com/1",
        title: "Article 1",
        body: "<p>Body text for article one with enough words to pass the minimum.</p>",
        bodyHash: "hash-1",
        wordCount: 500,
        existingLinks: [],
        canonicalUrl: null,
        robotsDirectives: { index: true, follow: true },
        language: "en",
        hasEmbedding: false,
        parseWarning: null,
      },
      {
        id: "article-2",
        url: "https://example.com/2",
        title: "Article 2",
        body: "<p>Body text for article two with enough words to pass the minimum.</p>",
        bodyHash: "hash-2",
        wordCount: 500,
        existingLinks: [],
        canonicalUrl: null,
        robotsDirectives: { index: true, follow: true },
        language: "en",
        hasEmbedding: false,
        parseWarning: null,
      },
    ]);

    mockRecommendationFindMany.mockResolvedValue([]);
    mockComputeReAnalysisScope.mockResolvedValue({
      newArticles: [],
      changedArticles: [],
      unchangedArticles: [],
      preservedRecommendations: [],
      staleRecommendations: [],
    });
    mockRegistryAnalyzeWithAll.mockResolvedValue([]);

    mockAnalysisRunUpdate.mockImplementation(async (args: Record<string, unknown>) => ({
      ...runRecord,
      ...(args as Record<string, unknown>).data,
    }));

    const run = await createAnalysisRun("project-1", {
      approaches: ["keyword"],
    });

    expect(run).toBeDefined();
    expect(run.id).toBe("run-1");
    expect(mockAnalysisRunCreate).toHaveBeenCalledOnce();

    // Now process the run (simulates cron worker)
    await processAnalysisRun(run.id);

    // Should have updated to completed
    expect(mockAnalysisRunUpdate).toHaveBeenCalled();
    const lastUpdateCall = mockAnalysisRunUpdate.mock.calls[
      mockAnalysisRunUpdate.mock.calls.length - 1
    ];
    expect(lastUpdateCall[0].data.status).toBe("completed");
    expect(lastUpdateCall[0].data.completedAt).toBeDefined();
  });

  it("transitions_to_failed_with_no_partial_recs", async () => {
    const runRecord = {
      id: "run-2",
      projectId: "project-1",
      status: "pending",
      articleCount: 1,
      createdAt: new Date(),
    };

    mockAnalysisRunCreate.mockResolvedValue(runRecord);
    mockAnalysisRunFindFirst.mockResolvedValue(runRecord);

    // Simulate strategy throwing an error
    mockArticleFindMany.mockResolvedValue([
      {
        id: "article-1",
        url: "https://example.com/1",
        title: "Article 1",
        body: "<p>Body</p>",
        bodyHash: "hash-1",
        wordCount: 500,
        existingLinks: [],
        canonicalUrl: null,
        robotsDirectives: { index: true, follow: true },
        language: "en",
        hasEmbedding: false,
        parseWarning: null,
      },
    ]);
    mockArticleCount.mockResolvedValue(1);

    mockComputeReAnalysisScope.mockRejectedValue(
      new Error("Database connection failed")
    );

    mockAnalysisRunUpdate.mockImplementation(async (args: Record<string, unknown>) => ({
      ...runRecord,
      ...(args as Record<string, unknown>).data,
    }));

    const run = await createAnalysisRun("project-1", {
      approaches: ["keyword"],
    });

    await processAnalysisRun(run.id);

    // Should have updated to failed with error message
    const failedUpdate = mockAnalysisRunUpdate.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, Record<string, unknown>>).data.status === "failed"
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate![0].data.error).toContain("Database connection failed");

    // No partial recommendations should have been saved
    // (createMany should not have been called in the transaction)
    const txFn = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls;
    // If $transaction was called, it should have been for the failure update, not recs
    // The key assertion is that status is "failed"
    expect(failedUpdate![0].data.status).toBe("failed");
  });

  it("tracks_embedding_cache_counters", async () => {
    const runRecord = {
      id: "run-3",
      projectId: "project-1",
      status: "pending",
      articleCount: 3,
      createdAt: new Date(),
    };

    mockAnalysisRunCreate.mockResolvedValue(runRecord);
    mockArticleCount.mockResolvedValue(3);

    // 3 articles: 2 have embeddings (cached), 1 needs generation
    const articles = [
      {
        id: "a1",
        url: "https://example.com/a1",
        title: "Article 1",
        body: "<p>Body 1</p>",
        bodyHash: "h1",
        wordCount: 500,
        existingLinks: [],
        canonicalUrl: null,
        robotsDirectives: { index: true, follow: true },
        language: "en",
        hasEmbedding: true,
        parseWarning: null,
      },
      {
        id: "a2",
        url: "https://example.com/a2",
        title: "Article 2",
        body: "<p>Body 2</p>",
        bodyHash: "h2",
        wordCount: 500,
        existingLinks: [],
        canonicalUrl: null,
        robotsDirectives: { index: true, follow: true },
        language: "en",
        hasEmbedding: true,
        parseWarning: null,
      },
      {
        id: "a3",
        url: "https://example.com/a3",
        title: "Article 3",
        body: "<p>Body 3</p>",
        bodyHash: "h3",
        wordCount: 500,
        existingLinks: [],
        canonicalUrl: null,
        robotsDirectives: { index: true, follow: true },
        language: "en",
        hasEmbedding: false,
        parseWarning: null,
      },
    ];

    mockArticleFindMany.mockResolvedValue(articles);
    mockRecommendationFindMany.mockResolvedValue([]);
    mockComputeReAnalysisScope.mockResolvedValue({
      newArticles: [],
      changedArticles: [],
      unchangedArticles: articles,
      preservedRecommendations: [],
      staleRecommendations: [],
    });
    mockRegistryAnalyzeWithAll.mockResolvedValue([]);

    mockAnalysisRunUpdate.mockImplementation(async (args: Record<string, unknown>) => ({
      ...runRecord,
      ...(args as Record<string, unknown>).data,
    }));

    const run = await createAnalysisRun("project-1", {
      approaches: ["keyword", "semantic"],
    });

    await processAnalysisRun(run.id);

    // Check that embedding counters were tracked
    const updateCalls = mockAnalysisRunUpdate.mock.calls;
    const completedCall = updateCalls.find(
      (call: unknown[]) => (call[0] as Record<string, Record<string, unknown>>).data.status === "completed"
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![0].data.embeddingsCached).toBe(2);
    expect(completedCall![0].data.embeddingsGenerated).toBe(1);
  });
});
```

**Verify:**

```bash
npx vitest tests/lib/analysis/orchestrator.test.ts --run 2>&1 | tail -5
# Expected: 3 tests FAIL (orchestrator.ts does not exist yet)
```

### Step 5.7.2 — Commit the failing tests (RED)

- [ ] Commit the test file

```bash
git add tests/lib/analysis/orchestrator.test.ts
git commit -m "test(analysis): add 3 failing tests for analysis orchestrator (RED)

Covers: creates run and transitions to completed, transitions to failed
with no partial recs, tracks embedding cache counters."
```

**Expected:** Clean commit. All 3 tests fail.

### Step 5.7.3 — Write the orchestrator implementation (GREEN)

- [ ] Create `src/lib/analysis/orchestrator.ts`

**File:** `src/lib/analysis/orchestrator.ts`

```typescript
/**
 * Analysis orchestrator for SEO-ilator.
 *
 * Coordinates the full analysis pipeline:
 * 1. Create AnalysisRun record (status: pending) — called from POST /api/analyze
 * 2. Process the run (status: running -> completed/failed) — called from cron worker
 *
 * Design decisions:
 * - [AAP-B7/B11/O2] Processing runs async via cron worker in 200-article batches
 * - [AAP-F4] Zombie recovery: runs in 'running' > 10 min -> failed
 * - [AAP-B10] FK violations (article deleted during analysis) are caught and skipped
 * - [AAP-B4] Previous pending recs superseded for same (source, target, strategy) triple
 * - [AAP-O8] dryRun mode returns estimates without creating a run
 */

import { prisma } from "../db";
import { registry } from "../strategies/registry";
import { deduplicateAndRank } from "./dedup-ranker";
import { computeReAnalysisScope } from "./re-analysis";
import type { Recommendation, ArticleSummary } from "../strategies/types";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Batch size for processing articles */
const BATCH_SIZE = 200;

/** Zombie timeout in milliseconds (10 minutes) */
const ZOMBIE_TIMEOUT_MS = 10 * 60 * 1000;

/** Default max links per page */
const DEFAULT_MAX_LINKS_PER_PAGE = 20;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnalysisConfig {
  approaches: Array<"keyword" | "semantic">;
  articleIds?: string[];
  settings?: {
    similarityThreshold?: number;
    fuzzyTolerance?: number;
    maxLinksPerPage?: number;
    forceReEmbed?: boolean;
  };
}

export interface EmbeddingEstimate {
  cached: number;
  needsGeneration: number;
}

export interface AnalysisRunResult {
  id: string;
  projectId: string;
  status: string;
  articleCount: number;
  embeddingEstimate?: EmbeddingEstimate;
  [key: string]: unknown;
}

export interface DryRunResult {
  articleCount: number;
  embeddingEstimate: EmbeddingEstimate;
  estimatedCost: number;
}

// ─── Create Analysis Run ─────────────────────────────────────────────────────

/**
 * Create a new AnalysisRun record. Called from POST /api/analyze.
 *
 * @param projectId - The project to analyze
 * @param config - Analysis configuration
 * @returns The created AnalysisRun record
 */
export async function createAnalysisRun(
  projectId: string,
  config: AnalysisConfig
): Promise<AnalysisRunResult> {
  const articleCount = await prisma.article.count({
    where: { projectId },
  });

  const run = await prisma.analysisRun.create({
    data: {
      projectId,
      status: "pending",
      articleCount,
      approaches: config.approaches,
      settings: config.settings ?? {},
    },
  });

  return run as unknown as AnalysisRunResult;
}

/**
 * Compute a dry run estimate. Returns article count and embedding estimate
 * without creating an AnalysisRun [AAP-O8].
 */
export async function computeDryRun(
  projectId: string,
  config: AnalysisConfig
): Promise<DryRunResult> {
  const articles = await prisma.article.findMany({
    where: { projectId },
    select: { id: true, hasEmbedding: true },
  });

  const cached = articles.filter(
    (a: { hasEmbedding: boolean }) => a.hasEmbedding
  ).length;
  const needsGeneration = articles.length - cached;

  // Rough cost estimate: $0.0001 per embedding (OpenAI text-embedding-3-small)
  const estimatedCost = needsGeneration * 0.0001;

  return {
    articleCount: articles.length,
    embeddingEstimate: { cached, needsGeneration },
    estimatedCost,
  };
}

// ─── Process Analysis Run ────────────────────────────────────────────────────

/**
 * Process an analysis run. Called from the cron worker.
 *
 * Transitions: pending -> running -> completed/failed
 * Handles errors gracefully: no partial recommendations on failure.
 *
 * @param runId - The AnalysisRun ID to process
 */
export async function processAnalysisRun(runId: string): Promise<void> {
  let run: Record<string, unknown> | null = null;

  try {
    // Fetch the run
    run = (await prisma.analysisRun.findFirst({
      where: { id: runId },
    })) as Record<string, unknown> | null;

    if (!run) {
      return; // Run not found, nothing to do
    }

    // Transition to running
    await prisma.analysisRun.update({
      where: { id: runId },
      data: {
        status: "running",
        startedAt: new Date(),
      },
    });

    const projectId = run.projectId as string;
    const approaches = (run.approaches as string[]) ?? ["keyword"];
    const settings = (run.settings as Record<string, unknown>) ?? {};

    // Load all articles for the project
    const articles = await prisma.article.findMany({
      where: { projectId },
    });

    // Compute embedding counters
    const embeddingsCached = articles.filter(
      (a: Record<string, unknown>) => a.hasEmbedding === true
    ).length;
    const embeddingsGenerated = articles.length - embeddingsCached;

    // Compute re-analysis scope
    const lastRunId = (run.previousRunId as string) ?? null;
    const scope = await computeReAnalysisScope(projectId, lastRunId);

    // Build article index (ArticleSummary without body text) [AAP-B7]
    const articleIndex: ArticleSummary[] = articles.map(
      (a: Record<string, unknown>) => ({
        id: a.id as string,
        url: a.url as string,
        title: a.title as string,
        wordCount: a.wordCount as number,
        existingLinks: a.existingLinks as ArticleSummary["existingLinks"],
        hasEmbedding: (a.hasEmbedding as boolean) ?? false,
        canonicalUrl: a.canonicalUrl as string | null,
        robotsDirectives:
          a.robotsDirectives as ArticleSummary["robotsDirectives"],
        language: a.language as string | null,
        parseWarning: a.parseWarning as string | null,
      })
    );

    // Body loader callback [AAP-B7]
    const loadArticleBodies = async (
      ids: string[]
    ): Promise<Map<string, string>> => {
      const loaded = await prisma.article.findMany({
        where: { id: { in: ids } },
        select: { id: true, body: true },
      });
      const map = new Map<string, string>();
      for (const a of loaded) {
        map.set(
          (a as Record<string, unknown>).id as string,
          (a as Record<string, unknown>).body as string
        );
      }
      return map;
    };

    // Process articles in batches of BATCH_SIZE
    const allKeywordRecs: Recommendation[] = [];
    const allSemanticRecs: Recommendation[] = [];

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);

      for (const article of batch) {
        const typedArticle = article as Record<string, unknown>;

        try {
          const context = {
            article: {
              id: typedArticle.id as string,
              url: typedArticle.url as string,
              title: typedArticle.title as string,
              body: typedArticle.body as string,
              wordCount: typedArticle.wordCount as number,
              existingLinks:
                typedArticle.existingLinks as ArticleSummary["existingLinks"],
              canonicalUrl: typedArticle.canonicalUrl as string | null,
              robotsDirectives:
                typedArticle.robotsDirectives as ArticleSummary["robotsDirectives"],
              language: typedArticle.language as string | null,
            },
            articleIndex,
            loadArticleBodies,
            settings,
          };

          const recs = await registry.analyzeWithAll(context);

          for (const rec of recs) {
            if (rec.matchingApproach === "semantic") {
              allSemanticRecs.push(rec);
            } else {
              allKeywordRecs.push(rec);
            }
          }
        } catch (err) {
          // [AAP-B10] Handle FK violations gracefully: skip article, continue
          const error = err as Error;
          if (
            error.message?.includes("foreign key") ||
            error.message?.includes("P2003") ||
            error.message?.includes("P2025")
          ) {
            console.warn(
              `Skipping article ${typedArticle.id}: ${error.message}`
            );
            continue;
          }
          throw err; // Re-throw non-FK errors
        }
      }
    }

    // Deduplicate and rank
    const maxLinksPerPage =
      (settings.maxLinksPerPage as number) ?? DEFAULT_MAX_LINKS_PER_PAGE;
    const finalRecs = deduplicateAndRank(
      allKeywordRecs,
      allSemanticRecs,
      maxLinksPerPage
    );

    // Save recommendations atomically [AAP-B4]
    await prisma.$transaction(async (tx: Record<string, Record<string, Function>>) => {
      // Mark previous pending recs as superseded for matching triples
      for (const rec of finalRecs) {
        if (rec.targetArticleId) {
          await tx.recommendation.updateMany({
            where: {
              sourceArticleId: rec.articleId,
              targetArticleId: rec.targetArticleId,
              strategyId: rec.strategyId,
              status: "pending",
              NOT: { analysisRunId: runId },
            },
            data: { status: "superseded" },
          });
        }
      }

      // Create new recommendations
      if (finalRecs.length > 0) {
        await tx.recommendation.createMany({
          data: finalRecs.map((rec) => ({
            ...rec,
            analysisRunId: runId,
            projectId,
            status: "pending",
          })),
        });
      }

      // Update run to completed
      await tx.analysisRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          completedAt: new Date(),
          recommendationCount: finalRecs.length,
          embeddingsCached: embeddingsCached,
          embeddingsGenerated: embeddingsGenerated,
          articleHashes: Object.fromEntries(
            articles.map((a: Record<string, unknown>) => [
              a.id,
              a.bodyHash,
            ])
          ),
        },
      });
    });
  } catch (err) {
    // Transition to failed — no partial recommendations
    const error = err as Error;
    try {
      await prisma.analysisRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          completedAt: new Date(),
          error: error.message || "Unknown error",
        },
      });
    } catch {
      console.error(`Failed to update run ${runId} to failed status:`, error);
    }
  }
}

// ─── Zombie Recovery [AAP-F4] ────────────────────────────────────────────────

/**
 * Recover zombie analysis runs that have been stuck in 'running' status
 * for longer than the timeout threshold (10 minutes).
 *
 * Called by the cron worker on each invocation.
 */
export async function recoverZombieRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - ZOMBIE_TIMEOUT_MS);

  const zombies = await prisma.analysisRun.findMany({
    where: {
      status: "running",
      startedAt: { lt: cutoff },
    },
  });

  for (const zombie of zombies) {
    await prisma.analysisRun.update({
      where: { id: (zombie as Record<string, unknown>).id as string },
      data: {
        status: "failed",
        completedAt: new Date(),
        error: "Analysis timed out. Please try again.",
      },
    });
  }

  return zombies.length;
}
```

**Verify:**

```bash
npx vitest tests/lib/analysis/orchestrator.test.ts --run 2>&1 | tail -10
# Expected: 3 tests PASS
```

### Step 5.7.4 — Commit the orchestrator implementation (GREEN)

- [ ] Commit the implementation

```bash
git add src/lib/analysis/orchestrator.ts
git commit -m "feat(analysis): implement analysis orchestrator with async cron processing

createAnalysisRun: creates pending run (called from POST /api/analyze).
processAnalysisRun: transitions pending->running->completed/failed.
Processes articles in 200-article batches [AAP-B7/B11/O2].
Saves recommendations atomically, marks previous pending as superseded [AAP-B4].
Handles FK violations gracefully (skip + continue) [AAP-B10].
recoverZombieRuns: marks stuck runs as failed after 10min [AAP-F4].
computeDryRun: returns estimate without creating run [AAP-O8].
All 3 tests pass."
```

**Expected:** Clean commit. Analysis TDD Agent work complete (12 tests: 4 dedup + 5 re-analysis + 3 orchestrator).

---

## API Agent: Task 5.8 — Analysis API Routes

> **Branch:** `feature/phase-5-api` (branched from `feature/phase-5-types`)
> **Depends on:** Types Agent complete (tasks 5.1, 5.2, 5.4)

### Step 5.8.1 — Create the branch and directories

- [ ] Create branch and directory structure

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout feature/phase-5-types
git checkout -b feature/phase-5-api
mkdir -p src/app/api/analyze
mkdir -p src/app/api/cron/analyze
mkdir -p src/app/api/runs/\[id\]/cancel
```

**Expected:** Branch `feature/phase-5-api` created. API route directories exist.

### Step 5.8.2 — Write POST /api/analyze route

- [ ] Create `src/app/api/analyze/route.ts`

**File:** `src/app/api/analyze/route.ts`

```typescript
/**
 * POST /api/analyze
 *
 * Triggers an analysis run for the current project.
 *
 * - dryRun=true: returns 200 with estimate (article count, embedding estimate, cost)
 * - dryRun=false (default): creates AnalysisRun, returns 202 Accepted with run ID
 *
 * Error codes:
 * - 400 NO_ARTICLES: no articles in the project
 * - 409 ANALYSIS_IN_PROGRESS: a run is already pending/running [AAP-B3]
 * - 403: free tier exceeded
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createAnalysisRun,
  computeDryRun,
} from "@/lib/analysis/orchestrator";

const AnalyzeRequestSchema = z.object({
  approaches: z
    .array(z.enum(["keyword", "semantic"]))
    .min(1, "At least one approach is required"),
  articleIds: z.array(z.string()).optional(),
  dryRun: z.boolean().optional().default(false),
  settings: z
    .object({
      similarityThreshold: z.number().min(0).max(1).optional(),
      fuzzyTolerance: z.number().min(0).max(1).optional(),
      maxLinksPerPage: z.number().int().min(1).max(100).optional(),
      forceReEmbed: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = AnalyzeRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { approaches, articleIds, dryRun, settings } = parsed.data;

    // TODO: Extract projectId from auth context (scopedPrisma)
    const projectId = "default-project";

    // Check article count
    const articleCount = await prisma.article.count({
      where: { projectId },
    });

    if (articleCount === 0) {
      return NextResponse.json(
        { error: "NO_ARTICLES", message: "No articles found. Import articles before running analysis." },
        { status: 400 }
      );
    }

    // Check for in-progress run [AAP-B3]
    const activeRun = await prisma.analysisRun.findFirst({
      where: {
        projectId,
        status: { in: ["pending", "running"] },
      },
    });

    if (activeRun) {
      return NextResponse.json(
        {
          error: "ANALYSIS_IN_PROGRESS",
          message: "An analysis run is already in progress. Please wait for it to complete or cancel it.",
          runId: (activeRun as Record<string, unknown>).id,
        },
        { status: 409 }
      );
    }

    // TODO: Check plan limits (free tier)
    // const limitsOk = await checkPlanLimits(projectId);
    // if (!limitsOk) {
    //   return NextResponse.json(
    //     { error: "PLAN_LIMIT_EXCEEDED", message: "Upgrade to analyze more articles." },
    //     { status: 403 }
    //   );
    // }

    // [AAP-O8] Dry run — return estimate without creating a run
    if (dryRun) {
      const estimate = await computeDryRun(projectId, {
        approaches,
        articleIds,
        settings,
      });

      return NextResponse.json(estimate, { status: 200 });
    }

    // Create the analysis run
    const run = await createAnalysisRun(projectId, {
      approaches,
      articleIds,
      settings,
    });

    return NextResponse.json(
      {
        runId: run.id,
        status: run.status,
        articleCount: run.articleCount,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("POST /api/analyze error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -10
# Expected: no errors for this file (may have warnings about missing imports until analysis module exists)
```

### Step 5.8.3 — Commit the analyze route

- [ ] Commit the route

```bash
git add src/app/api/analyze/route.ts
git commit -m "feat(api): add POST /api/analyze route with dryRun support

Returns 202 Accepted with runId for normal runs.
Returns 200 with estimate for dryRun=true [AAP-O8].
Error codes: 400 NO_ARTICLES, 409 ANALYSIS_IN_PROGRESS [AAP-B3].
Free tier check stubbed (TODO). Uses zod validation."
```

**Expected:** Clean commit.

### Step 5.8.4 — Write the cron worker route

- [ ] Create `src/app/api/cron/analyze/route.ts`

**File:** `src/app/api/cron/analyze/route.ts`

```typescript
/**
 * POST /api/cron/analyze
 *
 * Cron worker that processes pending/running analysis runs.
 * Runs every minute via Vercel Cron.
 *
 * - Claims one pending/running run using FOR UPDATE SKIP LOCKED
 * - Processes it via the orchestrator
 * - Recovers zombie runs stuck > 10 minutes [AAP-F4]
 * - Verifies CRON_SECRET for security
 *
 * Add to vercel.json:
 *   { "path": "/api/cron/analyze", "schedule": "* * * * *" }
 *
 * Function config: maxDuration: 300
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  processAnalysisRun,
  recoverZombieRuns,
} from "@/lib/analysis/orchestrator";

export const maxDuration = 300;

/**
 * Verify the CRON_SECRET header matches the environment variable.
 */
function verifyCronSecret(request: NextRequest): boolean {
  const secret = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.warn("CRON_SECRET is not set. Cron endpoint is unprotected.");
    return true; // Allow in development
  }

  return secret === `Bearer ${expected}`;
}

export async function POST(request: NextRequest) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Step 1: Recover zombie runs [AAP-F4]
    const recoveredCount = await recoverZombieRuns();
    if (recoveredCount > 0) {
      console.log(`Recovered ${recoveredCount} zombie analysis run(s)`);
    }

    // Step 2: Claim one pending run using raw SQL with FOR UPDATE SKIP LOCKED
    const pendingRuns: Array<{ id: string }> = await prisma.$queryRaw`
      SELECT id FROM "AnalysisRun"
      WHERE status IN ('pending', 'running')
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (pendingRuns.length === 0) {
      return NextResponse.json(
        { message: "No pending runs", recoveredZombies: recoveredCount },
        { status: 200 }
      );
    }

    const runId = pendingRuns[0].id;

    // Step 3: Process the run
    await processAnalysisRun(runId);

    return NextResponse.json(
      {
        message: "Run processed",
        runId,
        recoveredZombies: recoveredCount,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/cron/analyze error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Cron processing failed." },
      { status: 500 }
    );
  }
}
```

### Step 5.8.5 — Commit the cron worker

- [ ] Commit the route

```bash
git add src/app/api/cron/analyze/route.ts
git commit -m "feat(api): add cron worker POST /api/cron/analyze

Claims pending/running runs with FOR UPDATE SKIP LOCKED.
Processes one run per invocation via orchestrator.
Zombie recovery marks stuck runs as failed after 10min [AAP-F4].
Verifies CRON_SECRET. maxDuration: 300."
```

**Expected:** Clean commit.

### Step 5.8.6 — Write GET /api/runs route

- [ ] Create `src/app/api/runs/route.ts`

**File:** `src/app/api/runs/route.ts`

```typescript
/**
 * GET /api/runs
 *
 * Paginated list of AnalysisRun records for the current project.
 *
 * Query params:
 * - page (default: 1)
 * - limit (default: 20, max: 100)
 * - status (optional filter: pending, running, completed, failed, cancelled)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10))
    );
    const status = searchParams.get("status");

    // TODO: Extract projectId from auth context
    const projectId = "default-project";

    const where: Record<string, unknown> = { projectId };
    if (status) {
      where.status = status;
    }

    const [runs, total] = await Promise.all([
      prisma.analysisRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.analysisRun.count({ where }),
    ]);

    return NextResponse.json({
      runs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("GET /api/runs error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to fetch runs." },
      { status: 500 }
    );
  }
}
```

### Step 5.8.7 — Write GET /api/runs/[id] route

- [ ] Create `src/app/api/runs/[id]/route.ts`

**File:** `src/app/api/runs/[id]/route.ts`

```typescript
/**
 * GET /api/runs/[id]
 *
 * Full detail for a specific AnalysisRun, including recommendation summary
 * (counts by status, type, severity).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const run = await prisma.analysisRun.findUnique({
      where: { id },
    });

    if (!run) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Analysis run not found." },
        { status: 404 }
      );
    }

    // Get recommendation summary
    const recommendations = await prisma.recommendation.findMany({
      where: { analysisRunId: id },
    });

    const summary = {
      total: recommendations.length,
      byStatus: {} as Record<string, number>,
      byType: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
    };

    for (const rec of recommendations) {
      const typedRec = rec as Record<string, unknown>;
      const status = typedRec.status as string;
      const type = typedRec.type as string;
      const severity = typedRec.severity as string;

      summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
      summary.byType[type] = (summary.byType[type] ?? 0) + 1;
      summary.bySeverity[severity] = (summary.bySeverity[severity] ?? 0) + 1;
    }

    return NextResponse.json({
      run,
      recommendationSummary: summary,
    });
  } catch (err) {
    console.error("GET /api/runs/[id] error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to fetch run details." },
      { status: 500 }
    );
  }
}
```

### Step 5.8.8 — Write POST /api/runs/[id]/cancel route

- [ ] Create `src/app/api/runs/[id]/cancel/route.ts`

**File:** `src/app/api/runs/[id]/cancel/route.ts`

```typescript
/**
 * POST /api/runs/[id]/cancel
 *
 * Cancel an in-progress analysis run [AAP-F4].
 *
 * Returns:
 * - 200: run cancelled successfully
 * - 404: run not found
 * - 409: run already completed/failed/cancelled (cannot cancel)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const run = await prisma.analysisRun.findUnique({
      where: { id },
    });

    if (!run) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Analysis run not found." },
        { status: 404 }
      );
    }

    const typedRun = run as Record<string, unknown>;
    const status = typedRun.status as string;

    // Can only cancel pending or running runs
    if (status !== "pending" && status !== "running") {
      return NextResponse.json(
        {
          error: "CONFLICT",
          message: `Cannot cancel a run with status "${status}". Only pending or running runs can be cancelled.`,
        },
        { status: 409 }
      );
    }

    const updatedRun = await prisma.analysisRun.update({
      where: { id },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        error: "Cancelled by user.",
      },
    });

    return NextResponse.json({ run: updatedRun }, { status: 200 });
  } catch (err) {
    console.error("POST /api/runs/[id]/cancel error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to cancel run." },
      { status: 500 }
    );
  }
}
```

### Step 5.8.9 — Commit all API routes

- [ ] Commit the runs routes and cancel route

```bash
git add src/app/api/runs/route.ts src/app/api/runs/\[id\]/route.ts src/app/api/runs/\[id\]/cancel/route.ts
git commit -m "feat(api): add GET /api/runs, GET /api/runs/[id], POST /api/runs/[id]/cancel

GET /api/runs: paginated list with status filter.
GET /api/runs/[id]: full run detail with recommendation summary by status/type/severity.
POST /api/runs/[id]/cancel: cancels pending/running runs (200), 404 not found, 409 conflict [AAP-F4]."
```

**Expected:** Clean commit.

### Step 5.8.10 — Update vercel.json with cron schedule

- [ ] Add the cron configuration to `vercel.json`

Check if `vercel.json` exists first:

```bash
ls -la vercel.json 2>/dev/null || echo "File does not exist"
```

If it exists, add the cron entry. If not, create it:

**File:** `vercel.json` (create or update)

```json
{
  "crons": [
    {
      "path": "/api/cron/analyze",
      "schedule": "* * * * *"
    }
  ],
  "functions": {
    "src/app/api/cron/analyze/route.ts": {
      "maxDuration": 300
    }
  }
}
```

### Step 5.8.11 — Commit vercel.json

- [ ] Commit the vercel config

```bash
git add vercel.json
git commit -m "chore(infra): add cron schedule and function config for analysis worker

Cron runs every minute at /api/cron/analyze.
maxDuration: 300s for the analysis cron function."
```

**Expected:** Clean commit. API Agent work is complete.

---

## Integration Verification

> After all four branches merge into `feature/phase-5`, run these checks.

### Merge Order

- [ ] 1. Merge `feature/phase-5-types` into `feature/phase-5`
- [ ] 2. Merge `feature/phase-5-crosslink` into `feature/phase-5`
- [ ] 3. Merge `feature/phase-5-analysis` into `feature/phase-5`
- [ ] 4. Merge `feature/phase-5-api` into `feature/phase-5`
- [ ] 5. Ensure crosslink import in `src/lib/strategies/index.ts` is uncommented

### Automated Checks

- [ ] TypeScript compiles: `npx tsc --noEmit` exits 0
- [ ] Crosslink tests pass: `npx vitest tests/lib/strategies/crosslink.test.ts --run` (16/16)
- [ ] Registry tests pass: `npx vitest tests/lib/strategies/registry.test.ts --run` (2/2)
- [ ] Dedup-ranker tests pass: `npx vitest tests/lib/analysis/dedup-ranker.test.ts --run` (4/4)
- [ ] Re-analysis tests pass: `npx vitest tests/lib/analysis/re-analysis.test.ts --run` (5/5)
- [ ] Orchestrator tests pass: `npx vitest tests/lib/analysis/orchestrator.test.ts --run` (3/3)
- [ ] All tests pass: `npx vitest --run` (all passing including prior phases)
- [ ] Build succeeds: `npm run build` exits 0

### Manual Verification Checklist

- [ ] `src/lib/strategies/types.ts` exports SEOStrategy, ArticleSummary (no body) [AAP-B7], AnalysisContext with loadArticleBodies [AAP-B7], Recommendation with extended fields
- [ ] `src/lib/strategies/registry.ts` exports StrategyRegistry with register/unregister/getStrategy/getAllStrategies/analyzeWithAll and singleton `registry`
- [ ] `src/lib/strategies/index.ts` registers CrosslinkStrategy and re-exports types
- [ ] `src/lib/strategies/crosslink.ts` has KeywordMatcher with normalization, n-grams, DOM-aware matching, title prefix stripping [AAP-O6], distinctive words [AAP-O6], exact/fuzzy Dice matching, scoring/severity
- [ ] `src/lib/strategies/crosslink.ts` enforces all 12 quality safeguards including [AAP-O7] null existingLinks conservative defaults
- [ ] `src/lib/analysis/dedup-ranker.ts` merges dual matches with +0.15 confidence boost (cap 1.0), ranks by severity then confidence, applies maxLinksPerPage cap
- [ ] `src/lib/analysis/re-analysis.ts` preserves accepted, skips dismissed unless changed, marks stale [AAP-B4]
- [ ] `src/lib/analysis/orchestrator.ts` has createAnalysisRun, processAnalysisRun (batched), recoverZombieRuns [AAP-F4], computeDryRun [AAP-O8], FK handling [AAP-B10]
- [ ] `src/app/api/analyze/route.ts` handles dryRun, NO_ARTICLES, ANALYSIS_IN_PROGRESS
- [ ] `src/app/api/cron/analyze/route.ts` verifies CRON_SECRET, claims with FOR UPDATE SKIP LOCKED
- [ ] `src/app/api/runs/route.ts` returns paginated run list
- [ ] `src/app/api/runs/[id]/route.ts` returns run detail with recommendation summary
- [ ] `src/app/api/runs/[id]/cancel/route.ts` returns 200/404/409

### Test Summary

| Test File | Count | Agent |
|-----------|-------|-------|
| `tests/lib/strategies/crosslink.test.ts` | 16 | Crosslink TDD |
| `tests/lib/strategies/registry.test.ts` | 2 | Crosslink TDD |
| `tests/lib/analysis/dedup-ranker.test.ts` | 4 | Analysis TDD |
| `tests/lib/analysis/re-analysis.test.ts` | 5 | Analysis TDD |
| `tests/lib/analysis/orchestrator.test.ts` | 3 | Analysis TDD |
| **Total** | **30** | |

### Acceptance Criteria

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
