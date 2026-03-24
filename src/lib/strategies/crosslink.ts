/**
 * CrosslinkStrategy — identifies internal crosslinking opportunities
 * using keyword matching and fuzzy title matching (Dice coefficient),
 * and semantic matching via pgvector embeddings.
 */

import type {
  SEOStrategy,
  AnalysisContext,
  StrategyRecommendation,
  ArticleSummary,
} from "./types";
import { findSimilarArticles } from "@/lib/embeddings/similarity";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_SOURCE_WORDS = 50;
const MIN_DISTINCTIVE_WORDS = 3;
const DISTINCTIVE_COVERAGE = 0.6;
const DEFAULT_MAX_NEW_RECS = 10;
const DICE_THRESHOLD = 0.8;

/** Matches a 2-letter language prefix at the start of a URL path, e.g. /de/academy → /academy */
const LANG_PREFIX_RE = /^\/[a-z]{2}(?=\/)/;

const GENERIC_ANCHORS = new Set([
  "click here",
  "read more",
  "learn more",
  "this article",
  "this page",
  "here",
]);

const TITLE_PREFIXES = [
  "how to ",
  "a guide to ",
  "the best ",
  "what is ",
  "introduction to ",
  "getting started with ",
];

const STOP_WORDS = new Set([
  "the", "a", "an", "to", "of", "in", "for", "and", "or",
  "is", "it", "on", "at", "by", "with", "from", "how",
  "what", "which", "this", "that",
]);

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function stripTitlePrefix(title: string): string {
  const lower = title.toLowerCase();
  for (const prefix of TITLE_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return title.slice(prefix.length);
    }
  }
  return title;
}

export function getDistinctiveWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

export function sanitizeAnchorText(raw: string): string {
  // Strip HTML tags
  let text = raw.replace(/<[^>]*>/g, "");
  // Decode common HTML entities that could bypass checks
  text = text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  // Reject if javascript: URI (including entity-encoded variants)
  if (/javascript\s*:/i.test(text)) return "";
  // Reject event handler patterns (e.g., onmouseover=)
  if (/\bon\w+\s*=/i.test(text)) return "";
  // Reject any remaining angle brackets (incomplete tag stripping)
  if (/<|>/g.test(text)) return "";
  return text.trim();
}

export function diceCoefficient(a: string, b: string): number {
  const bigramsA = getBigrams(a.toLowerCase());
  const bigramsB = getBigrams(b.toLowerCase());
  if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

export function findInBody(
  body: string,
  searchText: string,
): { found: boolean; offset: number; context: string } | null {
  const lowerBody = body.toLowerCase();
  const lowerSearch = searchText.toLowerCase();
  const offset = lowerBody.indexOf(lowerSearch);
  if (offset === -1) return null;

  const contextStart = Math.max(0, offset - 50);
  const contextEnd = Math.min(body.length, offset + searchText.length + 50);
  const context = body.slice(contextStart, contextEnd);

  return { found: true, offset, context };
}

/**
 * Build concise anchor text for semantic matches.
 * Strips site name suffixes (e.g., " - Poultryscales"), common title prefixes,
 * and sanitizes the result. Returns empty string if unusable.
 */
export function buildSemanticAnchorText(title: string): string {
  // Strip site name suffix (common pattern: " - Site Name" or " | Site Name")
  let text = title.replace(/\s*[-|]\s*[^-|]+$/, "");
  // If stripping removed everything, fall back to original
  if (!text.trim()) text = title;
  // Strip common title prefixes
  text = stripTitlePrefix(text);
  // Sanitize
  text = sanitizeAnchorText(text);
  return text;
}

/**
 * Normalize a URL for dedup comparison:
 * - Resolve relative paths against the base URL
 * - Strip trailing slashes
 * - Strip 2-letter language prefixes (/de/academy/... → /academy/...)
 * - Remove fragments and query params
 */
export function normalizeUrlForDedup(href: string, baseUrl: string): string {
  try {
    const resolved = new URL(href, baseUrl);
    let pathname = resolved.pathname;
    // Remove trailing slash
    if (pathname.endsWith("/") && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    // Strip language prefix (e.g., /de/academy/... → /academy/...)
    pathname = pathname.replace(LANG_PREFIX_RE, "");
    return resolved.origin + pathname;
  } catch {
    return href;
  }
}

// ---------------------------------------------------------------------------
// CrosslinkStrategy
// ---------------------------------------------------------------------------

export class CrosslinkStrategy implements SEOStrategy {
  id = "crosslink";
  name = "Crosslink Analysis";
  description =
    "Identifies internal crosslinking opportunities by matching article titles and keywords in body text.";

  async analyze(context: AnalysisContext): Promise<StrategyRecommendation[]> {
    const { article, articleIndex, loadArticleBodies } = context;

    // Guard: need at least 2 articles
    if (articleIndex.length < 2) return [];

    // Guard: source must have sufficient word count
    if (article.wordCount < MIN_SOURCE_WORDS) return [];

    // Load source body
    const bodyMap = await loadArticleBodies([article.id]);
    const sourceBody = bodyMap.get(article.id);
    if (!sourceBody) return [];

    // Determine existing link URLs for dedup (normalized to catch relative paths
    // and language variants like /de/academy/... that resolve to the same article)
    const existingLinkUrls = new Set<string>();
    if (article.existingLinks !== null) {
      for (const link of article.existingLinks) {
        existingLinkUrls.add(normalizeUrlForDedup(link.href, article.url));
      }
    }

    // Determine max new recommendations budget.
    // maxLinksPerPage from settings caps NEW recs (not total links on the page).
    // Real-world pages often have 30-100+ existing links (nav, footer, inline),
    // so subtracting existingCount would suppress all recs for content-rich pages.
    const maxNew = typeof context.settings?.maxLinksPerPage === "number"
      ? context.settings.maxLinksPerPage
      : DEFAULT_MAX_NEW_RECS;

    const recommendations: StrategyRecommendation[] = [];

    for (const target of articleIndex) {
      if (recommendations.length >= maxNew) break;

      // Skip self
      if (target.id === article.id) continue;

      // Skip noindex
      if (target.noindex) continue;

      // Skip error pages (4xx/5xx)
      if (target.httpStatus !== null && target.httpStatus >= 400) continue;

      // Skip already-linked targets (normalize target URL for comparison)
      if (existingLinkUrls.has(normalizeUrlForDedup(target.url, target.url))) continue;

      const rec = this.matchTarget(article, target, sourceBody);
      if (rec) {
        recommendations.push(rec);
      }
    }

    // --- Semantic matching via pgvector ---
    // Wrapped in try-catch so a pgvector failure doesn't lose keyword recommendations
    try {
    if (article.hasEmbedding && recommendations.length < maxNew) {
      const keywordTargetIds = new Set(recommendations.map((r) => r.targetArticleId));

      // Use similarity threshold from settings, or default 0.65
      const threshold = typeof context.settings?.similarityThreshold === "number"
        ? context.settings.similarityThreshold
        : 0.65;

      const similarArticles = await findSimilarArticles(
        context.projectId,
        article.id,
        20,
        threshold,
      );

      // Build a lookup map for the article index
      const indexById = new Map<string, ArticleSummary>(
        articleIndex.map((a) => [a.id, a]),
      );

      for (const similar of similarArticles) {
        if (recommendations.length >= maxNew) break;

        // Skip self
        if (similar.id === article.id) continue;

        const target = indexById.get(similar.id);
        if (!target) continue;

        // Skip noindex
        if (target.noindex) continue;

        // Skip error pages
        if (target.httpStatus !== null && target.httpStatus >= 400) continue;

        // Skip already-linked targets
        if (existingLinkUrls.has(target.url)) continue;

        // Skip targets already found by keyword matching
        if (keywordTargetIds.has(similar.id)) continue;

        const anchorText = buildSemanticAnchorText(target.title);
        if (!anchorText) continue;

        const confidence = similar.similarity;
        const severity: "critical" | "warning" | "info" =
          confidence >= 0.85 ? "critical" : confidence >= 0.6 ? "warning" : "info";

        // Use cleaned title (without site suffix) for the display title
        const displayTitle = target.title.replace(/\s*[-|]\s*[^-|]+$/, "") || target.title;

        recommendations.push({
          strategyId: this.id,
          sourceArticleId: article.id,
          targetArticleId: similar.id,
          type: "crosslink",
          severity,
          title: `Link to "${displayTitle}"`,
          description: `Found semantically similar article (similarity: ${confidence.toFixed(2)}).`,
          anchorText,
          confidence,
          matchingApproach: "semantic",
          suggestion: {
            anchorText,
            targetUrl: target.url,
          },
        });
      }
    }
    } catch (semanticErr) {
      // Semantic matching failure should not lose keyword recommendations
      console.warn(
        `[crosslink] Semantic matching failed for article ${article.id}: ${semanticErr instanceof Error ? semanticErr.message : semanticErr}`
      );
    }

    return recommendations;
  }

  private matchTarget(
    source: ArticleSummary,
    target: ArticleSummary,
    sourceBody: string,
  ): StrategyRecommendation | null {
    const rawTitle = target.title;
    const strippedTitle = stripTitlePrefix(rawTitle);

    // Get distinctive words from stripped title
    const distinctiveWords = getDistinctiveWords(strippedTitle);
    if (distinctiveWords.length < MIN_DISTINCTIVE_WORDS) return null;

    // Sanitize anchor text
    const sanitized = sanitizeAnchorText(strippedTitle);
    if (!sanitized) return null;

    // Reject generic anchor text
    if (GENERIC_ANCHORS.has(sanitized.toLowerCase())) return null;

    // Try exact match first
    const exactMatch = findInBody(sourceBody, strippedTitle);
    if (exactMatch) {
      return this.buildRecommendation(
        source,
        target,
        sanitized,
        exactMatch,
        strippedTitle.length,
        1.0,
      );
    }

    // Try fuzzy match: sliding-window Dice coefficient over body text
    const lowerBody = sourceBody.toLowerCase();
    const lowerStripped = strippedTitle.toLowerCase();
    const windowLen = lowerStripped.length;
    let bestDice = 0;
    let bestOffset = -1;

    // Slide a window the size of the title across the body
    for (let i = 0; i <= lowerBody.length - windowLen; i++) {
      // Only start at word boundaries for efficiency
      if (i > 0 && lowerBody[i - 1] !== " " && lowerBody[i - 1] !== "\n") continue;

      const window = lowerBody.slice(i, i + windowLen);
      const dice = diceCoefficient(lowerStripped, window);
      if (dice > bestDice) {
        bestDice = dice;
        bestOffset = i;
      }
    }

    if (bestDice >= DICE_THRESHOLD && bestOffset >= 0) {
      const contextStart = Math.max(0, bestOffset - 50);
      const contextEnd = Math.min(sourceBody.length, bestOffset + windowLen + 50);
      const context = sourceBody.slice(contextStart, contextEnd);

      return this.buildRecommendation(
        source,
        target,
        sanitized,
        { found: true, offset: bestOffset, context },
        windowLen,
        bestDice,
      );
    }

    return null;
  }

  private buildRecommendation(
    source: ArticleSummary,
    target: ArticleSummary,
    anchorText: string,
    match: { found: boolean; offset: number; context: string },
    matchLength: number,
    confidence: number,
  ): StrategyRecommendation {
    const severity: "critical" | "warning" | "info" =
      confidence >= 0.85 ? "critical" : confidence >= 0.6 ? "warning" : "info";

    return {
      strategyId: this.id,
      sourceArticleId: source.id,
      targetArticleId: target.id,
      type: "crosslink",
      severity,
      title: `Link to "${target.title}"`,
      description: `Found keyword match for "${anchorText}" in article body.`,
      anchorText,
      confidence,
      matchingApproach: "keyword",
      sourceContext: match.context,
      charOffsetStart: match.offset,
      charOffsetEnd: match.offset + matchLength,
      suggestion: {
        anchorText,
        targetUrl: target.url,
      },
    };
  }
}
