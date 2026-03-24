import * as cheerio from "cheerio";
import { validateUrl } from "@/lib/ingestion/ssrf-guard";

const MAX_DEPTH = 2;
const MAX_URLS = 10_000;
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024; // 50MB

export interface SitemapResult {
  urls: string[];
  warnings: string[];
}

/**
 * Normalizes a URL for deduplication purposes:
 * - Lowercases the scheme and host
 * - Removes a trailing slash from the path (unless path is just "/")
 */
function normalizeUrlForDedup(raw: string): string {
  try {
    const u = new URL(raw);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Fetches a URL (after SSRF validation), returning { text, contentType } or null on error.
 * Adds a warning to the provided array on failure.
 */
async function safeFetch(
  url: string,
  warnings: string[]
): Promise<{ text: string; contentType: string } | null> {
  // SSRF guard
  const validation = await validateUrl(url);
  if (!validation.safe) {
    warnings.push(
      `SSRF guard blocked URL (skipped): ${url} — ${validation.reason ?? "unsafe"}`
    );
    return null;
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    warnings.push(`Failed to fetch ${url}: ${(err as Error).message}`);
    return null;
  }

  if (!response.ok) {
    warnings.push(
      `Non-200 HTTP status ${response.status} fetching ${url}`
    );
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    warnings.push(`Failed to read response body from ${url}: ${(err as Error).message}`);
    return null;
  }

  // Decompressed size guard
  if (text.length > MAX_DECOMPRESSED_BYTES) {
    warnings.push(
      `Response from ${url} exceeds 50MB decompressed size limit; truncating`
    );
    text = text.slice(0, MAX_DECOMPRESSED_BYTES);
  }

  return { text, contentType };
}

/**
 * Parses a plain-text URL list (one URL per line).
 */
function parsePlainTextUrls(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && (line.startsWith("http://") || line.startsWith("https://")));
}

/**
 * Core recursive fetch-and-parse function.
 * depth starts at 0 for the root sitemap; child sitemaps are fetched at depth+1.
 * Maximum depth for following sitemapindex entries is MAX_DEPTH (2).
 */
async function fetchAndParse(
  url: string,
  depth: number,
  seen: Set<string>,
  collected: string[],
  warnings: string[]
): Promise<void> {
  // Depth enforcement: we allow depth 0 (root) and depth 1 (children of index).
  // At depth 2 we should stop following sitemapindex entries.
  const fetched = await safeFetch(url, warnings);
  if (!fetched) return;

  const { text, contentType } = fetched;

  // Detect plain-text URL list.
  // Content-type alone is not reliable (jsdom sets text/plain by default on mock Responses).
  // Treat as XML if the content starts with "<" or the content-type explicitly mentions xml.
  // Only treat as plain text if the content clearly does NOT look like XML.
  const trimmed = text.trimStart();
  const looksLikeXml =
    trimmed.startsWith("<") ||
    trimmed.startsWith("\uFEFF<") || // BOM + XML
    contentType.includes("xml");
  const isPlainText = !looksLikeXml;

  if (isPlainText) {
    const urls = parsePlainTextUrls(text);
    if (urls.length === 0) {
      warnings.push(
        `No URLs found in response from ${url}; content does not look like XML or a valid URL list`
      );
      return;
    }
    for (const u of urls) {
      if (collected.length >= MAX_URLS) break;
      const normalized = normalizeUrlForDedup(u);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        collected.push(u);
      }
    }
    return;
  }

  // XML parsing via cheerio
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(text, { xml: true });
  } catch (err) {
    warnings.push(
      `Failed to parse XML from ${url}: ${(err as Error).message}`
    );
    return;
  }

  // Detect sitemap index
  const isSitemapIndex = $("sitemapindex").length > 0;

  if (isSitemapIndex) {
    const childLocs: string[] = [];
    $("sitemapindex > sitemap > loc").each((_, el) => {
      const loc = $(el).text().trim();
      if (loc) childLocs.push(loc);
    });

    if (depth >= MAX_DEPTH) {
      warnings.push(
        `Sitemap index at depth ${depth} exceeds maximum recursion depth of ${MAX_DEPTH}; child sitemaps skipped`
      );
      return;
    }

    for (const childLoc of childLocs) {
      await fetchAndParse(childLoc, depth + 1, seen, collected, warnings);
    }
    return;
  }

  // Detect urlset
  const isUrlset = $("urlset").length > 0;

  if (isUrlset) {
    const beforeCount = collected.length;
    let hitLimit = false;
    $("urlset > url > loc").each((_, el) => {
      if (collected.length >= MAX_URLS) {
        hitLimit = true;
        return false; // break cheerio loop
      }
      const loc = $(el).text().trim();
      if (!loc) return;
      const normalized = normalizeUrlForDedup(loc);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        collected.push(loc);
      }
    });
    if (hitLimit) {
      warnings.push(
        `URL count cap of 10,000 reached while parsing ${url}; additional URLs were truncated`
      );
    }
    return;
  }

  // Neither a recognized sitemap index nor a urlset
  warnings.push(
    `Unrecognized sitemap format at ${url}; no <sitemapindex> or <urlset> found`
  );
}

/**
 * Parses a sitemap (or plain-text URL list) at the given URL.
 * Follows sitemapindex entries up to 2 levels deep (root → index → urlset).
 * Enforces SSRF guard, URL count cap (10,000), and dedup.
 */
export async function parseSitemap(url: string): Promise<SitemapResult> {
  const warnings: string[] = [];
  const collected: string[] = [];
  const seen = new Set<string>();

  await fetchAndParse(url, 0, seen, collected, warnings);

  // Cap at MAX_URLS (may have been exceeded across multiple child sitemaps)
  if (collected.length > MAX_URLS) {
    warnings.push(
      `URL count exceeded 10,000 limit; truncated to 10,000 URLs`
    );
    collected.splice(MAX_URLS);
  }

  return { urls: collected, warnings };
}
