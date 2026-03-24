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
