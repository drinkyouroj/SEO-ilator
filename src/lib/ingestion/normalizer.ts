import { createHash } from "node:crypto";
import type { ParsedArticle, NormalizedArticle } from "./types";

export function computeHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function normalizeArticle(
  parsed: ParsedArticle,
  projectId: string,
  sourceType: "crawl" | "upload" | "push"
): NormalizedArticle {
  return {
    url: parsed.url,
    title: parsed.title,
    body: parsed.body,
    bodyHash: computeHash(parsed.body),
    titleHash: computeHash(parsed.title),
    wordCount: parsed.wordCount,
    existingLinks: parsed.existingLinks,
    metadata: parsed.metadata,
    sourceType,
    parseWarning: parsed.parseWarning,
  };
}
