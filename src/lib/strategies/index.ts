import { registry } from "./registry";
import { CrosslinkStrategy } from "./crosslink";

// Register all strategies at import time
registry.register(new CrosslinkStrategy());

export { registry };
export type { SEOStrategy, AnalysisContext, StrategyRecommendation, ArticleSummary } from "./types";
