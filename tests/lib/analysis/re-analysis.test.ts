import { describe, it, expect } from "vitest";
import { computeReAnalysisScope } from "@/lib/analysis/re-analysis";

interface MockArticle { id: string; bodyHash: string; titleHash: string }
interface MockRec { id?: string; sourceArticleId: string; targetArticleId: string; strategyId: string; status: string }

describe("computeReAnalysisScope", () => {
  it("identifies_new_articles_since_last_run", () => {
    const articles: MockArticle[] = [
      { id: "a1", bodyHash: "h1", titleHash: "t1" },
      { id: "a2", bodyHash: "h2", titleHash: "t2" },
    ];
    const lastRunArticleIds = new Set(["a1"]);
    const scope = computeReAnalysisScope(articles, lastRunArticleIds, new Map(), []);
    expect(scope.newArticleIds).toContain("a2");
    expect(scope.newArticleIds).not.toContain("a1");
  });

  it("identifies_changed_articles_by_hash", () => {
    const articles: MockArticle[] = [{ id: "a1", bodyHash: "new-hash", titleHash: "t1" }];
    const lastRunArticleIds = new Set(["a1"]);
    const lastRunHashes = new Map([["a1", { bodyHash: "old-hash", titleHash: "t1" }]]);
    const scope = computeReAnalysisScope(articles, lastRunArticleIds, lastRunHashes, []);
    expect(scope.changedArticleIds).toContain("a1");
  });

  it("preserves_accepted_recommendations", () => {
    const articles: MockArticle[] = [{ id: "a1", bodyHash: "h1", titleHash: "t1" }];
    const existingRecs: MockRec[] = [
      { id: "r1", sourceArticleId: "a1", targetArticleId: "a2", strategyId: "crosslink", status: "accepted" },
    ];
    const scope = computeReAnalysisScope(articles, new Set(["a1"]), new Map([["a1", { bodyHash: "h1", titleHash: "t1" }]]), existingRecs);
    expect(scope.preservedRecIds).toContain("r1");
  });

  it("skips_dismissed_when_content_unchanged", () => {
    const articles: MockArticle[] = [{ id: "a1", bodyHash: "h1", titleHash: "t1" }];
    const existingRecs: MockRec[] = [
      { id: "r1", sourceArticleId: "a1", targetArticleId: "a2", strategyId: "crosslink", status: "dismissed" },
    ];
    const scope = computeReAnalysisScope(articles, new Set(["a1"]), new Map([["a1", { bodyHash: "h1", titleHash: "t1" }]]), existingRecs);
    expect(scope.preservedRecIds).toContain("r1");
  });

  it("regenerates_dismissed_when_content_changed", () => {
    const articles: MockArticle[] = [{ id: "a1", bodyHash: "new-hash", titleHash: "t1" }];
    const existingRecs: MockRec[] = [
      { id: "r1", sourceArticleId: "a1", targetArticleId: "a2", strategyId: "crosslink", status: "dismissed" },
    ];
    const scope = computeReAnalysisScope(articles, new Set(["a1"]), new Map([["a1", { bodyHash: "old-hash", titleHash: "t1" }]]), existingRecs);
    expect(scope.preservedRecIds).not.toContain("r1");
    expect(scope.changedArticleIds).toContain("a1");
  });
});
