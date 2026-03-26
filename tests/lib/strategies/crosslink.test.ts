import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArticleSummary, AnalysisContext, StrategyRecommendation } from "@/lib/strategies/types";
import { CrosslinkStrategy, normalizeUrlForDedup, findSemanticAnchorText, buildSemanticDisplayTitle } from "@/lib/strategies/crosslink";
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
  it("still_produces_recs_when_existingLinks_is_null", async () => {
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

    // maxNew defaults to DEFAULT_MAX_NEW_RECS (10) — existingLinks no longer reduces budget
    expect(recs.length).toBeLessThanOrEqual(10);
    expect(recs.length).toBeGreaterThan(0);
  });

  // 12
  it("respects_maxLinksPerPage_from_settings", async () => {
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
    // Set maxLinksPerPage to 3 via settings
    const ctx = makeContext(source, [source, ...targets], bodies, { maxLinksPerPage: 3 });

    const recs = await strategy.analyze(ctx);

    expect(recs.length).toBeLessThanOrEqual(3);
    expect(recs.length).toBeGreaterThan(0);
  });

  // 12b
  it("produces_recs_for_articles_with_many_existing_links", async () => {
    const existingLinks = Array.from({ length: 50 }, (_, i) => ({
      href: `https://example.com/existing-${i}`,
      anchorText: `Existing Link ${i}`,
    }));
    const source = makeArticle({ id: "src", wordCount: 5000, existingLinks });
    const target = makeArticle({ id: "tgt", title: "React Hooks Guide" });
    const bodies = {
      src: "Learn about building apps. You should read the React Hooks Guide to understand state management. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    // Articles with many existing links should still get recommendations
    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeDefined();
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

describe("normalizeUrlForDedup", () => {
  it("resolves_relative_paths_against_base_url", () => {
    expect(
      normalizeUrlForDedup("/academy/some-article", "https://example.com/academy/other")
    ).toBe("https://example.com/academy/some-article");
  });

  it("strips_trailing_slashes", () => {
    expect(
      normalizeUrlForDedup("https://example.com/academy/article/", "https://example.com")
    ).toBe("https://example.com/academy/article");
  });

  it("strips_language_prefix_from_path", () => {
    expect(
      normalizeUrlForDedup("/de/academy/some-article", "https://example.com/page")
    ).toBe("https://example.com/academy/some-article");
  });

  it("strips_language_prefix_from_absolute_urls", () => {
    expect(
      normalizeUrlForDedup("https://example.com/fr/academy/article", "https://example.com")
    ).toBe("https://example.com/academy/article");
  });

  it("returns_original_href_for_unparseable_urls", () => {
    expect(normalizeUrlForDedup("not-a-url", "also-not-a-url")).toBe("not-a-url");
  });

  it("preserves_absolute_urls_without_language_prefix", () => {
    expect(
      normalizeUrlForDedup("https://example.com/academy/article", "https://example.com")
    ).toBe("https://example.com/academy/article");
  });
});

describe("findSemanticAnchorText", () => {
  it("finds_relevant_phrase_in_source_body", () => {
    const body = "Our farm improved efficiency by using automated sorting equipment to grade birds. This reduced labor costs significantly.";
    const result = findSemanticAnchorText("How Poultry Sorting Equipment Boosts Profits - Poultryscales", body);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(body.length);
  });

  it("falls_back_to_title_keywords_when_no_body_match", () => {
    const body = "This article discusses completely unrelated topics about database optimization.";
    const result = findSemanticAnchorText("How Poultry Sorting Equipment Boosts Profits - Poultryscales", body);
    expect(result.length).toBeGreaterThan(0);
    expect(result.toLowerCase()).toContain("poultry");
  });

  it("strips_site_suffix_before_matching", () => {
    const body = "Feed mixture composition plays a critical role in growth rates.";
    const result = findSemanticAnchorText("Feed mixture and its structure to maximize growth - Poultryscales", body);
    expect(result).not.toContain("Poultryscales");
    expect(result.length).toBeGreaterThan(0);
  });

  it("sanitizes_xss_from_title", () => {
    const result = findSemanticAnchorText('<script>alert("x")</script>Poultry Guide', "Some body text about poultry guide topics.");
    expect(result).not.toMatch(/<script>/i);
  });

  it("produces_concise_phrase_not_full_sentence", () => {
    const body = "When weighing poultry flocks you need accurate sorting equipment to classify birds by weight and grade them efficiently for market.";
    const result = findSemanticAnchorText("Poultry Sorting Equipment Guide", body);
    const wordCount = result.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(8);
    expect(wordCount).toBeGreaterThanOrEqual(3);
  });
});

describe("buildSemanticDisplayTitle", () => {
  it("strips_site_suffix_for_display", () => {
    expect(buildSemanticDisplayTitle("Poultry Growth - Poultryscales")).toBe("Poultry Growth");
  });

  it("keeps_full_title_without_suffix", () => {
    expect(buildSemanticDisplayTitle("Feed mixture and growth")).toBe("Feed mixture and growth");
  });
});

describe("CrosslinkStrategy — URL dedup", () => {
  const strategy = new CrosslinkStrategy();

  beforeEach(() => {
    idCounter = 0;
    vi.mocked(findSimilarArticles).mockResolvedValue([]);
  });

  it("skips_targets_linked_via_relative_paths", async () => {
    const target = makeArticle({
      id: "tgt",
      title: "React Hooks Guide",
      url: "https://example.com/academy/react-hooks-guide",
    });
    const source = makeArticle({
      id: "src",
      url: "https://example.com/academy/source-article",
      wordCount: 500,
      existingLinks: [{ href: "/academy/react-hooks-guide", anchorText: "Hooks" }],
    });
    const bodies = {
      src: "Read the React Hooks Guide for more info on hooks. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeUndefined();
  });

  it("skips_targets_linked_via_language_variant_paths", async () => {
    const target = makeArticle({
      id: "tgt",
      title: "React Hooks Guide",
      url: "https://example.com/academy/react-hooks-guide",
    });
    const source = makeArticle({
      id: "src",
      url: "https://example.com/academy/source-article",
      wordCount: 500,
      existingLinks: [{ href: "/de/academy/react-hooks-guide", anchorText: "Hooks (DE)" }],
    });
    const bodies = {
      src: "Read the React Hooks Guide for more info on hooks. " + "word ".repeat(300),
    };
    const ctx = makeContext(source, [source, target], bodies);

    const recs = await strategy.analyze(ctx);

    const rec = recs.find((r) => r.targetArticleId === "tgt");
    expect(rec).toBeUndefined();
  });
});
