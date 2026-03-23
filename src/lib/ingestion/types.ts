export interface ParsedArticle {
  url: string;
  title: string;
  body: string;
  wordCount: number;
  existingLinks: ExistingLink[];
  metadata: ArticleMetadata;
  parseWarning: string | null;
}

export interface ExistingLink {
  href: string;
  anchorText: string;
}

export interface ArticleMetadata {
  canonical: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2s: string[];
  noindex: boolean;
  nofollow: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
}

export type CrawlPreset = "gentle" | "standard" | "fast";

export const PRESET_DELAYS: Record<CrawlPreset, number> = {
  gentle: 1000,
  standard: 333,
  fast: 100,
};

export interface CrawlResult {
  html: string;
  httpStatus: number;
  responseTimeMs: number;
  redirectChain: string[];
  error?: string;
}

export interface NormalizedArticle {
  url: string;
  title: string;
  body: string;
  bodyHash: string;
  titleHash: string;
  wordCount: number;
  existingLinks: ExistingLink[];
  metadata: ArticleMetadata;
  sourceType: "crawl" | "upload" | "push";
  parseWarning: string | null;
}

/** Result from SSRF URL validation */
export interface UrlValidationResult {
  safe: boolean;
  resolvedIp?: string;
  reason?: string;
}

/** Result from robots.txt check */
export interface RobotsCheckResult {
  allowed: boolean;
  crawlDelay?: number;
}

/** Failure classification for retry logic */
export type FailureType = "transient" | "permanent" | "ssrf" | "robots";

export function classifyHttpError(status: number): FailureType {
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return "transient";
  }
  return "permanent";
}
