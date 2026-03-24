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
      strategyId: "s1", sourceArticleId: "a1", targetArticleId: "a2",
      type: "crosslink", severity: "warning", title: "Link to A2",
      description: "Test", confidence: 0.8,
    };
    const rec2: StrategyRecommendation = {
      strategyId: "s2", sourceArticleId: "a1", targetArticleId: "a3",
      type: "meta", severity: "info", title: "Meta issue",
      description: "Test", confidence: 0.5,
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
