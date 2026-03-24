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

  async analyzeWithAll(context: AnalysisContext): Promise<StrategyRecommendation[]> {
    const results: StrategyRecommendation[] = [];
    for (const strategy of this.strategies.values()) {
      const recs = await strategy.analyze(context);
      results.push(...recs);
    }
    return results;
  }
}

export const registry = new StrategyRegistry();
