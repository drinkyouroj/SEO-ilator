import type { SEOStrategy, AnalysisContext, StrategyRecommendation } from "./types";

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
   * Per-strategy error isolation: one failing strategy doesn't lose others' results.
   */
  async analyzeWithAll(context: AnalysisContext): Promise<StrategyRecommendation[]> {
    const results: StrategyRecommendation[] = [];
    for (const strategy of this.strategies.values()) {
      try {
        const recs = await strategy.analyze(context);
        results.push(...recs);
      } catch (err) {
        console.error(
          `[registry] Strategy "${strategy.id}" failed for article ${context.article.id}:`,
          err instanceof Error ? err.message : err
        );
        // Continue with remaining strategies — don't lose their recommendations
      }
    }
    return results;
  }
}

export const registry = new StrategyRegistry();
