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
    expect(result).toHaveLength(1);
    expect(result[0].matchingApproach).toBe("both");
  });

  it("boosts_confidence_on_dual_match", () => {
    const keyword = makeRec({ matchingApproach: "keyword", confidence: 0.7 });
    const semantic = makeRec({ matchingApproach: "semantic", confidence: 0.8 });
    const result = dedupAndRank([keyword, semantic]);
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
    expect(result[0].confidence).toBeGreaterThan(result[result.length - 1].confidence);
  });
});
