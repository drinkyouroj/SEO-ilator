import * as cheerio from "cheerio";
import { marked } from "marked";
import type { ParsedArticle, ExistingLink, ArticleMetadata } from "./types";

/**
 * Parse raw HTML into structured article data using cheerio.
 * This is the single shared parsing path for all ingestion methods.
 */
export function parseHTML(
  html: string,
  url: string,
  httpStatus?: number,
  responseTimeMs?: number
): ParsedArticle {
  const $ = cheerio.load(html);

  // Remove scripts and styles before text extraction
  $("script, style, noscript").remove();

  // Title: <title> tag, fallback to first <h1>
  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "";

  // Body: prefer <main>, then <article>, then <body>
  let bodyElement = $("main").first();
  if (bodyElement.length === 0) bodyElement = $("article").first();
  if (bodyElement.length === 0) bodyElement = $("body").first();

  const body = bodyElement.text().replace(/\s+/g, " ").trim();
  const wordCount = body ? body.split(/\s+/).length : 0;

  // Existing internal links
  const parsedUrl = new URL(url);
  const existingLinks: ExistingLink[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const anchorText = $(el).text().trim();
    if (!anchorText) return;

    // Internal link: same domain or relative path
    try {
      const resolved = new URL(href, url);
      if (resolved.hostname === parsedUrl.hostname) {
        // Preserve the original href value (relative paths stay relative,
        // absolute same-domain URLs keep their full form)
        existingLinks.push({ href, anchorText });
      }
    } catch {
      // Relative path that starts with /
      if (href.startsWith("/")) {
        existingLinks.push({ href, anchorText });
      }
    }
  });

  // Metadata
  const robotsMeta = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
  const metadata: ArticleMetadata = {
    canonical: $('link[rel="canonical"]').attr("href") || null,
    metaTitle: $("title").first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr("content") || null,
    h1: $("h1").first().text().trim() || null,
    h2s: $("h2").map((_, el) => $(el).text().trim()).get(),
    noindex: robotsMeta.includes("noindex"),
    nofollow: robotsMeta.includes("nofollow"),
    httpStatus: httpStatus ?? null,
    responseTimeMs: responseTimeMs ?? null,
  };

  // Parse warning: near-empty body on 200 responses only (AAP-O1)
  // Do NOT fire when httpStatus is undefined (upload/push/markdown paths)
  const parseWarning =
    wordCount < 50 && httpStatus === 200
      ? "near-empty-body"
      : null;

  return {
    url,
    title,
    body,
    wordCount,
    existingLinks,
    metadata,
    parseWarning,
  };
}

/**
 * Parse Markdown content by converting to HTML first, then using parseHTML.
 * This ensures a single parsing path for all content types.
 */
export function parseMarkdown(md: string, url: string): ParsedArticle {
  const html = marked.parse(md, { async: false }) as string;
  // Wrap in basic HTML structure so cheerio can find headings
  const wrappedHtml = `<html><body><article>${html}</article></body></html>`;
  return parseHTML(wrappedHtml, url);
}
