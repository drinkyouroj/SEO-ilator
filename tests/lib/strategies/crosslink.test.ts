import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArticleSummary, AnalysisContext, StrategyRecommendation } from "@/lib/strategies/types";
import { CrosslinkStrategy } from "@/lib/strategies/crosslink";
import { findSimilarArticles } from "@/lib/embeddings/similarity";

vi.mock("@/lib/embeddings/similarity", () => ({
  findSimilarArticles: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function makeArticle(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  idCounter += 1;
  const id = overrides.id ?? `art-${idCounter}`;
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Article ${id}`,
    wordCount: 500,
    existingLinks: [],
    hasEmbedding: false,
    canonicalUrl: null,
    noindex: false,
    nofollow: false,
    httpStatus: 200,
    parseWarning: null,
    ...overrides,
  };
}

function makeContext(
  article: ArticleSummary,
  articleIndex: ArticleSummary[],
  bodies: Record<string, string>,
  settings: Record<string, unknown> = {},
): AnalysisContext {
  return {
    article,
    articleIndex,
    loadArticleBodies: vi.fn().mockResolvedValue(new Map(Object.entries(bodies))),
    projectId: "proj-test",
    settings,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CrosslinkStrategy", () => {
  const strategy = new CrosslinkStrategy();

  beforeEach(() => {
    idCounter = 0;
  });

  // 1
  it("finds_exact_title_match_in_body_text", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const target = makeArticle({ id: "tgt", title: "React Hooks Guide" });
    const bodies = {
      src: "Learn about building apps. You should read the React Hooks Guide to understand state management in modern applications. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    expect(recs.length).toBeGreaterThanOrEqual(1);
    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeDefined();
    expect(rec!.type).toBe("crosslink");
    expect(rec!.matchingApproach).toBe("keyword");
    expect(rec!.anchorText).toBeDefined();
  });

  // 2
  it("finds_fuzzy_match_with_dice_coefficient", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const target = makeArticle({ id: "tgt", title: "React Hooks Pattern" });
    const bodies = {
      src: "This article covers React Hook Patterns for building scalable frontend apps. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeDefined();
    expect(rec!.matchingApproach).toBe("keyword");
  });

  // 3
  it("skips_self_links", async () => {
    const source = makeArticle({ id: "src", title: "React Hooks Guide", wordCount: 500 });
    const other = makeArticle({ id: "other", title: "Vue Composition API" });
    const bodies = {
      src: "This is the React Hooks Guide article. It covers everything about hooks. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, other], bodies);

    const recs = await strategy.analyze(ctx);

    const selfLink = recs.find((r) => r.targetArticleId === "src");
    expect(selfLink).toBeUndefined();
  });

  // 4
  it("skips_existing_linked_pairs", async () => {
    const target = makeArticle({ id: "tgt", title: "React Hooks Guide" });
    const source = makeArticle({
      id: "src",
      wordCount: 500,
      existingLinks: [{ href: target.url, anchorText: "React Hooks Guide" }],
    });
    const bodies = {
      src: "Read the React Hooks Guide for more info on hooks. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeUndefined();
  });

  // 5
  it("skips_noindex_targets", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const target = makeArticle({ id: "tgt", title: "React Hooks Guide", noindex: true });
    const bodies = {
      src: "Read the React Hooks Guide for more info. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeUndefined();
  });

  // 6
  it("enforces_minimum_word_count_for_sources", async () => {
    const source = makeArticle({ id: "src", wordCount: 30 });
    const target = makeArticle({ id: "tgt", title: "React Hooks Guide" });
    const bodies = {
      src: "React Hooks Guide is great. " + "word ".repeat(20),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    expect(recs).toEqual([]);
  });

  // 7
  it("returns_empty_for_single_article_index", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const bodies = { src: "Some content. " + "word ".repeat(300) };
    const ctx = makeContext(source, [source], bodies);

    const recs = await strategy.analyze(ctx);

    expect(recs).toEqual([]);
  });

  // 8
  it("returns_empty_for_empty_index", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const bodies = { src: "Some content. " + "word ".repeat(300) };
    const ctx = makeContext(source, [], bodies);

    const recs = await strategy.analyze(ctx);

    expect(recs).toEqual([]);
  });

  // 9
  it("strips_common_title_prefixes_before_matching", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const target = makeArticle({ id: "tgt", title: "How to Use TypeScript Generics" });
    const bodies = {
      src: "When working with TypeScript Generics you can create reusable components. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeDefined();
    expect(rec!.matchingApproach).toBe("keyword");
  });

  // 10
  it("rejects_matches_with_fewer_than_3_distinctive_words", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const target = makeArticle({ id: "tgt", title: "The Best" });
    const bodies = {
      src: "This is the best content you will find anywhere online. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeUndefined();
  });

  // 11
  it("uses_conservative_defaults_when_existingLinks_is_null", async () => {
    const targets: ArticleSummary[] = [];
    const bodyParts: string[] = [];
    for (let i = 0; i < 12; i++) {
      const t = makeArticle({ id: `tgt-${i}`, title: `Unique Strategy Pattern ${i} Guide` });
      targets.push(t);
      bodyParts.push(`Read about Unique Strategy Pattern ${i} Guide for details.`);
    }
    const source = makeArticle({ id: "src", wordCount: 5000, existingLinks: null });
    const bodies = {
      src: bodyParts.join(" ") + " " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, ...targets], bodies);

    const recs = await strategy.analyze(ctx);

    // With null existingLinks assumed as 5, max new = 10, so at most 5 new links (10 - 5 = 5)
    expect(recs.length).toBeLessThanOrEqual(5);
    expect(recs.length).toBeGreaterThan(0);
  });

  // 12
  it("respects_max_links_per_page", async () => {
    const targets: ArticleSummary[] = [];
    const bodyParts: string[] = [];
    for (let i = 0; i < 20; i++) {
      const t = makeArticle({ id: `tgt-${i}`, title: `Advanced Framework Concept ${i} Details` });
      targets.push(t);
      bodyParts.push(`Learn more about Advanced Framework Concept ${i} Details in this section.`);
    }
    const source = makeArticle({ id: "src", wordCount: 5000, existingLinks: [] });
    const bodies = {
      src: bodyParts.join(" ") + " " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, ...targets], bodies);

    const recs = await strategy.analyze(ctx);

    expect(recs.length).toBeLessThanOrEqual(10);
  });

  // 13
  it("rejects_generic_anchor_text", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const target = makeArticle({ id: "tgt", title: "Click Here" });
    const bodies = {
      src: "You should click here to find the answer to everything. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeUndefined();
  });

  // 14
  it("captures_source_context_and_char_offsets", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const target = makeArticle({ id: "tgt", title: "React Hooks Guide" });
    const bodies = {
      src: "Introduction to building apps. You should study the React Hooks Guide to master state management. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeDefined();
    expect(rec!.sourceContext).toBeDefined();
    expect(typeof rec!.sourceContext).toBe("string");
    expect(rec!.sourceContext!.length).toBeGreaterThan(0);
    expect(typeof rec!.charOffsetStart).toBe("number");
    expect(typeof rec!.charOffsetEnd).toBe("number");
    expect(rec!.charOffsetStart!).toBeGreaterThanOrEqual(0);
    expect(rec!.charOffsetEnd!).toBeGreaterThan(rec!.charOffsetStart!);
  });

  // 15
  it("sanitizes_anchor_text_against_xss", async () => {
    const source = makeArticle({ id: "src", wordCount: 500 });
    const target = makeArticle({
      id: "tgt",
      title: '<script>alert("xss")</script>React Hooks Advanced Guide',
    });
    const bodies = {
      src: 'Read about <script>alert("xss")</script>React Hooks Advanced Guide to learn patterns. ' + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    if (rec) {
      expect(rec.anchorText).not.toMatch(/<script>/i);
      expect(rec.anchorText).not.toMatch(/javascript:/i);
    }
    // If rejected entirely due to sanitization, that's also acceptable
  });
});

describe("CrosslinkStrategy — semantic matching", () => {
  const strategy = new CrosslinkStrategy();

  beforeEach(() => {
    vi.mocked(findSimilarArticles).mockResolvedValue([]);
  });

  // 16
  it("finds_semantic_matches_via_pgvector", async () => {
    const mockSimilar = vi.mocked(findSimilarArticles);
    mockSimilar.mockResolvedValueOnce([
      { id: "a2", url: "https://example.com/similar", title: "Similar Topic", similarity: 0.85 },
    ]);

    const source = makeArticle({ id: "a1", wordCount: 500, hasEmbedding: true });
    const target = makeArticle({ id: "a2", title: "Similar Topic", url: "https://example.com/similar", hasEmbedding: true });
    const bodies = { a1: "This article covers various topics in depth. " + "word ".repeat(300) };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    const semantic = recs.filter((r) => r.matchingApproach === "semantic");
    expect(semantic.length).toBeGreaterThanOrEqual(1);
    expect(semantic[0]?.targetArticleId).toBe("a2");
  });

  // 17
  it("skips_semantic_when_source_has_no_embedding", async () => {
    const source = makeArticle({ id: "a1", wordCount: 500, hasEmbedding: false });
    const target = makeArticle({ id: "a2", title: "Topic", hasEmbedding: true });
    const bodies = { a1: "This article covers various topics in depth. " + "word ".repeat(300) };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);
    const semantic = recs.filter((r) => r.matchingApproach === "semantic");
    expect(semantic).toHaveLength(0);
  });
});
