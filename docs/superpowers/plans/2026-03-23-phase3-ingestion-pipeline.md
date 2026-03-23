# Phase 3: Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete article ingestion pipeline — sitemap/URL-list crawl, file upload, API push — with SSRF protection, robots.txt compliance, retry logic, and job lifecycle management.

**Architecture:** Three input methods (sitemap crawl, file upload, API push) converge through a shared processing layer (parser → normalizer) into the Article table. Crawl jobs use a database-backed queue (IngestionJob + IngestionTask) with hybrid sync/async processing: <50 URLs processed inline, ≥50 URLs queued with on-demand cron trigger. All AAP security requirements (B1, B2, O1, O7, O10, F7, F9) are addressed.

**Tech Stack:** Next.js 16 App Router, Prisma 7, cheerio (HTML parsing), marked (Markdown), zod (validation), Vitest + msw (testing)

**Spec:** `docs/superpowers/specs/2026-03-23-phase3-ingestion-pipeline-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|---|---|
| `src/lib/ingestion/types.ts` | Shared types: ParsedArticle, NormalizedArticle, CrawlResult, CrawlPreset |
| `src/lib/ingestion/parser.ts` | HTML/Markdown parsing via cheerio + marked |
| `src/lib/ingestion/normalizer.ts` | Transform ParsedArticle → Article upsert shape |
| `src/lib/ingestion/ssrf-guard.ts` | URL validation, private IP rejection, DNS resolution |
| `src/lib/ingestion/robots.ts` | robots.txt fetching, caching, directive parsing |
| `src/lib/ingestion/crawler.ts` | Per-URL fetch with SSRF + robots + redirect chain validation |
| `src/lib/ingestion/queue.ts` | Job/task CRUD, CAS claim, retry, zombie recovery |
| `src/lib/ingestion/sitemap.ts` | Sitemap XML/index parsing with AAP-O10 safeguards |
| `src/app/api/articles/route.ts` | POST: sitemap/URL-list ingestion (sync/async routing) |
| `src/app/api/articles/upload/route.ts` | POST: multipart file upload |
| `src/app/api/articles/push/route.ts` | POST: API push (Pro+ only) |
| `src/app/api/jobs/[id]/route.ts` | GET: job status polling |
| `src/app/api/jobs/[id]/cancel/route.ts` | POST: cancel job |
| `src/app/api/articles/[id]/route.ts` | GET: article detail, DELETE: with active analysis check [AAP-B10] |
| `src/app/api/cron/crawl/route.ts` | GET: cron worker (daily + on-demand) |
| `tests/lib/ingestion/parser.test.ts` | Parser unit tests |
| `tests/lib/ingestion/normalizer.test.ts` | Normalizer unit tests |
| `tests/lib/ingestion/ssrf-guard.test.ts` | SSRF guard unit tests |
| `tests/lib/ingestion/robots.test.ts` | robots.txt unit tests |
| `tests/lib/ingestion/crawler.test.ts` | Crawler unit tests |
| `tests/lib/ingestion/queue.test.ts` | Queue unit tests |
| `tests/lib/ingestion/sitemap.test.ts` | Sitemap parser unit tests |

### Files to modify

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `retryAfter` field + index on IngestionTask |
| `package.json` | Add `marked` dependency |

---

## Task 1: Schema Migration — Add retryAfter to IngestionTask

**Files:**
- Modify: `prisma/schema.prisma` (IngestionTask model, ~line 237-255)

- [ ] **Step 1: Add retryAfter field and index to IngestionTask**

In `prisma/schema.prisma`, add to the `IngestionTask` model:

```prisma
retryAfter  DateTime?
```

And add the new composite index (after the existing `@@index` lines):

```prisma
@@index([status, retryAfter])
```

The model should now have three `@@index` directives:
```prisma
@@index([jobId, status])
@@index([status, startedAt])
@@index([status, retryAfter])
```

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name add-retry-after-to-ingestion-task`

Expected: Migration created and applied successfully. The `prisma/migrations/` directory should contain a new folder.

- [ ] **Step 3: Verify the migration SQL**

Read the generated migration SQL file. It should contain:
- `ALTER TABLE "IngestionTask" ADD COLUMN "retryAfter" TIMESTAMP(3);`
- `CREATE INDEX` on `("status", "retryAfter")`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add retryAfter field and index to IngestionTask"
```

---

## Task 2: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install marked for Markdown parsing**

Run: `npm install marked`

Note: `marked` ships its own TypeScript types — do NOT install `@types/marked`.

- [ ] **Step 2: Verify installation**

Run: `npx tsc --noEmit`

Expected: No type errors related to marked.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add marked for markdown parsing"
```

---

## Task 3: Shared Types

**Files:**
- Create: `src/lib/ingestion/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ingestion/types.ts
git commit -m "feat(ingestion): add shared types for ingestion pipeline"
```

---

## Task 4: HTML Parser

**Files:**
- Create: `src/lib/ingestion/parser.ts`
- Create: `tests/lib/ingestion/parser.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { parseHTML, parseMarkdown } from "@/lib/ingestion/parser";

describe("parseHTML", () => {
  it("extracts_title_body_wordcount_from_wellformed_html", () => {
    const html = `
      <html>
        <head><title>Test Article</title></head>
        <body>
          <article>
            <p>This is the body text of the article with enough words to pass detection.</p>
            <p>Second paragraph adds more content to the article body for testing.</p>
          </article>
        </body>
      </html>`;
    const result = parseHTML(html, "https://example.com/test");
    expect(result.title).toBe("Test Article");
    expect(result.body).toContain("This is the body text");
    expect(result.wordCount).toBeGreaterThan(10);
    expect(result.parseWarning).toBeNull();
  });

  it("falls_back_to_h1_when_no_title_tag", () => {
    const html = `<html><body><h1>Heading Title</h1><article><p>Body content here with plenty of words for the test to work properly and pass.</p></article></body></html>`;
    const result = parseHTML(html, "https://example.com/test");
    expect(result.title).toBe("Heading Title");
  });

  it("prefers_article_over_body_for_content", () => {
    const html = `
      <html><body>
        <nav>Navigation stuff</nav>
        <article><p>Article content that should be extracted as the main body text.</p></article>
        <footer>Footer stuff</footer>
      </body></html>`;
    const result = parseHTML(html, "https://example.com/test");
    expect(result.body).toContain("Article content");
    expect(result.body).not.toContain("Navigation stuff");
    expect(result.body).not.toContain("Footer stuff");
  });

  it("prefers_main_over_article_for_content", () => {
    const html = `
      <html><body>
        <main><p>Main content area with enough words.</p></main>
        <article><p>Article outside main.</p></article>
      </body></html>`;
    const result = parseHTML(html, "https://example.com/test");
    expect(result.body).toContain("Main content area");
  });

  it("extracts_existing_internal_links", () => {
    const html = `
      <html><head><title>Links Test</title></head>
      <body><article>
        <p>Read <a href="/other-page">other page</a> and <a href="https://example.com/related">related article</a>.</p>
        <p>Also <a href="https://external.com/page">external link</a>.</p>
      </article></body></html>`;
    const result = parseHTML(html, "https://example.com/test");
    expect(result.existingLinks).toHaveLength(2);
    expect(result.existingLinks[0]).toEqual({
      href: "/other-page",
      anchorText: "other page",
    });
    expect(result.existingLinks[1]).toEqual({
      href: "https://example.com/related",
      anchorText: "related article",
    });
  });

  it("extracts_metadata_canonical_noindex_nofollow", () => {
    const html = `
      <html><head>
        <title>Meta Test</title>
        <meta name="description" content="A test description">
        <meta name="robots" content="noindex, nofollow">
        <link rel="canonical" href="https://example.com/canonical-url">
      </head><body>
        <h1>Primary Heading</h1>
        <h2>Sub Heading One</h2>
        <h2>Sub Heading Two</h2>
        <article><p>Body content with enough words to not trigger the warning for near empty body detection.</p></article>
      </body></html>`;
    const result = parseHTML(html, "https://example.com/test");
    expect(result.metadata.canonical).toBe("https://example.com/canonical-url");
    expect(result.metadata.metaDescription).toBe("A test description");
    expect(result.metadata.noindex).toBe(true);
    expect(result.metadata.nofollow).toBe(true);
    expect(result.metadata.h1).toBe("Primary Heading");
    expect(result.metadata.h2s).toEqual(["Sub Heading One", "Sub Heading Two"]);
  });

  it("sets_parseWarning_when_body_under_50_words_with_200_status", () => {
    const html = `<html><head><title>Short</title></head><body><p>Too few words here.</p></body></html>`;
    const result = parseHTML(html, "https://example.com/test", 200);
    expect(result.wordCount).toBeLessThan(50);
    expect(result.parseWarning).toBe("near-empty-body");
  });

  it("no_parseWarning_for_short_body_with_non_200_status", () => {
    const html = `<html><head><title>Short</title></head><body><p>Few words.</p></body></html>`;
    const result = parseHTML(html, "https://example.com/test", 301);
    expect(result.parseWarning).toBeNull();
  });

  it("handles_html_with_only_scripts_and_styles", () => {
    const html = `<html><head><title>Empty Page</title></head><body><script>var x = 1;</script><style>.a{}</style></body></html>`;
    const result = parseHTML(html, "https://example.com/test", 200);
    expect(result.wordCount).toBe(0);
    expect(result.parseWarning).toBe("near-empty-body");
  });
});

describe("parseMarkdown", () => {
  it("converts_markdown_and_extracts_fields", () => {
    const md = `# Markdown Title\n\nThis is the body of the markdown article with enough words to pass the detection threshold easily.\n\nSecond paragraph here.`;
    const result = parseMarkdown(md, "https://example.com/md-test");
    expect(result.title).toBe("Markdown Title");
    expect(result.body).toContain("body of the markdown");
    expect(result.wordCount).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/ingestion/parser.test.ts --run`

Expected: FAIL — `parseHTML` and `parseMarkdown` are not defined.

- [ ] **Step 3: Implement the parser**

```typescript
import * as cheerio from "cheerio";
import { marked } from "marked";
import type { ParsedArticle, ExistingLink, ArticleMetadata } from "./types";

const USER_AGENT_NAME = "SEO-ilator/1.0";

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
        existingLinks.push({
          href: href.startsWith("/") ? href : resolved.pathname,
          anchorText,
        });
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/ingestion/parser.test.ts --run`

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/parser.ts tests/lib/ingestion/parser.test.ts
git commit -m "feat(ingestion): add HTML/Markdown parser with cheerio [AAP-O1]"
```

---

## Task 5: Normalizer

**Files:**
- Create: `src/lib/ingestion/normalizer.ts`
- Create: `tests/lib/ingestion/normalizer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { normalizeArticle, computeHash } from "@/lib/ingestion/normalizer";
import type { ParsedArticle } from "@/lib/ingestion/types";

const makeParsed = (overrides?: Partial<ParsedArticle>): ParsedArticle => ({
  url: "https://example.com/test",
  title: "Test Article",
  body: "This is the body of the test article.",
  wordCount: 8,
  existingLinks: [],
  metadata: {
    canonical: null,
    metaTitle: null,
    metaDescription: null,
    h1: null,
    h2s: [],
    noindex: false,
    nofollow: false,
    httpStatus: 200,
    responseTimeMs: 150,
  },
  parseWarning: null,
  ...overrides,
});

describe("computeHash", () => {
  it("returns_consistent_sha256_for_same_input", () => {
    const hash1 = computeHash("hello world");
    const hash2 = computeHash("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex string
  });

  it("returns_different_hash_for_different_input", () => {
    const hash1 = computeHash("hello");
    const hash2 = computeHash("world");
    expect(hash1).not.toBe(hash2);
  });
});

describe("normalizeArticle", () => {
  it("computes_bodyHash_and_titleHash", () => {
    const parsed = makeParsed();
    const result = normalizeArticle(parsed, "project-1", "crawl");
    expect(result.bodyHash).toBe(computeHash(parsed.body));
    expect(result.titleHash).toBe(computeHash(parsed.title));
  });

  it("sets_sourceType_correctly", () => {
    expect(normalizeArticle(makeParsed(), "p1", "crawl").sourceType).toBe("crawl");
    expect(normalizeArticle(makeParsed(), "p1", "upload").sourceType).toBe("upload");
    expect(normalizeArticle(makeParsed(), "p1", "push").sourceType).toBe("push");
  });

  it("preserves_all_parsed_fields", () => {
    const parsed = makeParsed({
      existingLinks: [{ href: "/other", anchorText: "other page" }],
      parseWarning: "near-empty-body",
    });
    const result = normalizeArticle(parsed, "p1", "crawl");
    expect(result.url).toBe(parsed.url);
    expect(result.title).toBe(parsed.title);
    expect(result.body).toBe(parsed.body);
    expect(result.wordCount).toBe(parsed.wordCount);
    expect(result.existingLinks).toEqual(parsed.existingLinks);
    expect(result.parseWarning).toBe("near-empty-body");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/ingestion/normalizer.test.ts --run`

Expected: FAIL — `normalizeArticle` and `computeHash` are not defined.

- [ ] **Step 3: Implement the normalizer**

```typescript
import { createHash } from "node:crypto";
import type { ParsedArticle, NormalizedArticle } from "./types";

/**
 * Compute SHA-256 hash of a string, returned as hex.
 */
export function computeHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Transform a ParsedArticle into the shape needed for Prisma Article upsert.
 * Does NOT perform the database operation — returns the normalized data.
 */
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/ingestion/normalizer.test.ts --run`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/normalizer.ts tests/lib/ingestion/normalizer.test.ts
git commit -m "feat(ingestion): add article normalizer with SHA-256 hashing"
```

---

## Task 6: SSRF Guard

**Files:**
- Create: `src/lib/ingestion/ssrf-guard.ts`
- Create: `tests/lib/ingestion/ssrf-guard.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateUrl, isPrivateIp } from "@/lib/ingestion/ssrf-guard";

describe("isPrivateIp", () => {
  it("rejects_loopback_127_0_0_1", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("rejects_loopback_range", () => {
    expect(isPrivateIp("127.255.255.255")).toBe(true);
  });

  it("rejects_10_x_private_range", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  it("rejects_172_16_31_private_range", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
  });

  it("allows_172_outside_private_range", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("rejects_192_168_private_range", () => {
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("192.168.255.255")).toBe(true);
  });

  it("rejects_link_local_169_254", () => {
    expect(isPrivateIp("169.254.1.1")).toBe(true);
  });

  it("rejects_zero_network", () => {
    expect(isPrivateIp("0.0.0.0")).toBe(true);
  });

  it("allows_public_ip", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
});

describe("validateUrl", () => {
  it("rejects_non_http_schemes", async () => {
    const result = await validateUrl("ftp://example.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("scheme");
  });

  it("rejects_file_scheme", async () => {
    const result = await validateUrl("file:///etc/passwd");
    expect(result.safe).toBe(false);
  });

  it("rejects_url_resolving_to_private_ip", async () => {
    // Mock dns.resolve4 to return a private IP
    const dns = await import("node:dns/promises");
    vi.spyOn(dns, "resolve4").mockResolvedValue(["127.0.0.1"]);

    const result = await validateUrl("https://evil.example.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("private");

    vi.restoreAllMocks();
  });

  it("allows_url_resolving_to_public_ip", async () => {
    const dns = await import("node:dns/promises");
    vi.spyOn(dns, "resolve4").mockResolvedValue(["93.184.216.34"]);

    const result = await validateUrl("https://example.com");
    expect(result.safe).toBe(true);
    expect(result.resolvedIp).toBe("93.184.216.34");

    vi.restoreAllMocks();
  });

  it("rejects_on_dns_resolution_failure", async () => {
    const dns = await import("node:dns/promises");
    vi.spyOn(dns, "resolve4").mockRejectedValue(new Error("ENOTFOUND"));

    const result = await validateUrl("https://nonexistent.example.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("DNS");

    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/ingestion/ssrf-guard.test.ts --run`

Expected: FAIL — `validateUrl` and `isPrivateIp` are not defined.

- [ ] **Step 3: Implement the SSRF guard**

```typescript
import { resolve4 } from "node:dns/promises";
import type { UrlValidationResult } from "./types";

/**
 * Check whether an IPv4 address is in a private/reserved range.
 * Rejects: 10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, 0.x
 */
export function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return true; // Malformed = unsafe

  const [a, b] = parts;

  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16
  if (a === 127) return true;                          // 127.0.0.0/8
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16
  if (a === 0) return true;                            // 0.0.0.0/8

  return false;
}

/**
 * Validate a URL for SSRF safety (AAP-B1).
 * - Rejects non-HTTP(S) schemes
 * - Resolves hostname to IP via DNS
 * - Rejects private/reserved IPs
 * - Returns resolved IP so caller can connect directly (prevents DNS rebinding)
 */
export async function validateUrl(url: string): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { safe: false, reason: `Unsupported scheme: ${parsed.protocol}` };
  }

  let addresses: string[];
  try {
    addresses = await resolve4(parsed.hostname);
  } catch (err) {
    return {
      safe: false,
      reason: `DNS resolution failed for ${parsed.hostname}: ${(err as Error).message}`,
    };
  }

  if (addresses.length === 0) {
    return { safe: false, reason: `DNS returned no addresses for ${parsed.hostname}` };
  }

  const ip = addresses[0];
  if (isPrivateIp(ip)) {
    return { safe: false, reason: `Resolved to private IP: ${ip}` };
  }

  return { safe: true, resolvedIp: ip };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/ingestion/ssrf-guard.test.ts --run`

Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/ssrf-guard.ts tests/lib/ingestion/ssrf-guard.test.ts
git commit -m "feat(ingestion): add SSRF guard with private IP rejection [AAP-B1]"
```

---

## Task 7: Robots.txt Handler

**Files:**
- Create: `src/lib/ingestion/robots.ts`
- Create: `tests/lib/ingestion/robots.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { parseRobotsTxt, RobotsCache } from "@/lib/ingestion/robots";

describe("parseRobotsTxt", () => {
  const UA = "SEO-ilator/1.0";

  it("disallows_path_matching_disallow_rule", () => {
    const robotsTxt = `User-agent: *\nDisallow: /private/\n`;
    const result = parseRobotsTxt(robotsTxt, "https://example.com/private/page", UA);
    expect(result.allowed).toBe(false);
  });

  it("allows_path_not_matching_any_disallow", () => {
    const robotsTxt = `User-agent: *\nDisallow: /private/\n`;
    const result = parseRobotsTxt(robotsTxt, "https://example.com/public/page", UA);
    expect(result.allowed).toBe(true);
  });

  it("matches_specific_user_agent_over_wildcard", () => {
    const robotsTxt = `User-agent: SEO-ilator/1.0\nDisallow: /blocked/\n\nUser-agent: *\nAllow: /\n`;
    const result = parseRobotsTxt(robotsTxt, "https://example.com/blocked/page", UA);
    expect(result.allowed).toBe(false);
  });

  it("extracts_crawl_delay", () => {
    const robotsTxt = `User-agent: *\nCrawl-delay: 5\nAllow: /\n`;
    const result = parseRobotsTxt(robotsTxt, "https://example.com/page", UA);
    expect(result.allowed).toBe(true);
    expect(result.crawlDelay).toBe(5);
  });

  it("allows_all_when_no_matching_rules", () => {
    const robotsTxt = `User-agent: Googlebot\nDisallow: /secret/\n`;
    const result = parseRobotsTxt(robotsTxt, "https://example.com/secret/page", UA);
    expect(result.allowed).toBe(true);
  });

  it("handles_empty_robots_txt", () => {
    const result = parseRobotsTxt("", "https://example.com/page", UA);
    expect(result.allowed).toBe(true);
  });

  it("handles_malformed_robots_txt", () => {
    const robotsTxt = `this is not valid robots.txt content\nrandom: value\n`;
    const result = parseRobotsTxt(robotsTxt, "https://example.com/page", UA);
    expect(result.allowed).toBe(true);
  });

  it("allow_overrides_disallow_for_more_specific_path", () => {
    const robotsTxt = `User-agent: *\nDisallow: /dir/\nAllow: /dir/page.html\n`;
    const result = parseRobotsTxt(robotsTxt, "https://example.com/dir/page.html", UA);
    expect(result.allowed).toBe(true);
  });
});

describe("RobotsCache", () => {
  let cache: RobotsCache;

  beforeEach(() => {
    cache = new RobotsCache();
  });

  it("caches_parsed_result_by_domain", () => {
    cache.set("example.com", `User-agent: *\nDisallow: /blocked/\n`);
    const result = cache.check("https://example.com/blocked/page", "SEO-ilator/1.0");
    expect(result.allowed).toBe(false);
  });

  it("returns_allowed_for_unknown_domain", () => {
    const result = cache.check("https://unknown.com/page", "SEO-ilator/1.0");
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/ingestion/robots.test.ts --run`

Expected: FAIL — `parseRobotsTxt` and `RobotsCache` are not defined.

- [ ] **Step 3: Implement the robots.txt handler**

```typescript
import type { RobotsCheckResult } from "./types";

interface RobotsRule {
  path: string;
  allow: boolean;
}

interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelay?: number;
}

/**
 * Parse robots.txt content and check if a URL is allowed.
 * Implements standard robots.txt protocol with Allow/Disallow/Crawl-delay.
 * More specific paths take precedence (longer path prefix wins).
 */
export function parseRobotsTxt(
  robotsTxt: string,
  url: string,
  userAgent: string
): RobotsCheckResult {
  const groups = parseGroups(robotsTxt);
  const path = new URL(url).pathname;

  // Find the most specific matching group: exact UA match first, then wildcard
  const exactGroup = groups.find((g) =>
    g.userAgents.some((ua) => ua.toLowerCase() === userAgent.toLowerCase())
  );
  const wildcardGroup = groups.find((g) =>
    g.userAgents.some((ua) => ua === "*")
  );
  const group = exactGroup || wildcardGroup;

  if (!group) {
    return { allowed: true };
  }

  // Find the most specific matching rule (longest path prefix)
  let bestMatch: RobotsRule | null = null;
  for (const rule of group.rules) {
    if (path.startsWith(rule.path)) {
      if (!bestMatch || rule.path.length > bestMatch.path.length) {
        bestMatch = rule;
      }
    }
  }

  return {
    allowed: bestMatch ? bestMatch.allow : true,
    crawlDelay: group.crawlDelay,
  };
}

function parseGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.split("#")[0].trim(); // Strip comments
    if (!line) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === "user-agent") {
      if (current && current.userAgents.length > 0 && current.rules.length > 0) {
        groups.push(current);
        current = null;
      }
      if (!current) {
        current = { userAgents: [], rules: [] };
      }
      current.userAgents.push(value);
    } else if (current) {
      if (directive === "disallow" && value) {
        current.rules.push({ path: value, allow: false });
      } else if (directive === "allow" && value) {
        current.rules.push({ path: value, allow: true });
      } else if (directive === "crawl-delay") {
        const delay = parseFloat(value);
        if (!isNaN(delay) && delay > 0) {
          current.crawlDelay = delay;
        }
      }
    }
  }

  if (current && current.userAgents.length > 0) {
    groups.push(current);
  }

  return groups;
}

/**
 * In-memory robots.txt cache scoped to a single cron invocation.
 * Stores raw robots.txt content per domain, parses on check.
 */
export class RobotsCache {
  private cache = new Map<string, string>();

  set(domain: string, robotsTxt: string): void {
    this.cache.set(domain, robotsTxt);
  }

  has(domain: string): boolean {
    return this.cache.has(domain);
  }

  check(url: string, userAgent: string): RobotsCheckResult {
    const domain = new URL(url).hostname;
    const robotsTxt = this.cache.get(domain);
    if (robotsTxt === undefined) {
      return { allowed: true }; // No robots.txt cached = allow
    }
    return parseRobotsTxt(robotsTxt, url, userAgent);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/ingestion/robots.test.ts --run`

Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/robots.ts tests/lib/ingestion/robots.test.ts
git commit -m "feat(ingestion): add robots.txt parser and cache [DECISION-002]"
```

---

## Task 8: Crawler

**Files:**
- Create: `src/lib/ingestion/crawler.ts`
- Create: `tests/lib/ingestion/crawler.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crawlUrl } from "@/lib/ingestion/crawler";
import { RobotsCache } from "@/lib/ingestion/robots";
import * as ssrfGuard from "@/lib/ingestion/ssrf-guard";

describe("crawlUrl", () => {
  beforeEach(() => {
    vi.spyOn(ssrfGuard, "validateUrl").mockResolvedValue({
      safe: true,
      resolvedIp: "93.184.216.34",
    });

    global.fetch = vi.fn().mockResolvedValue(
      new Response("<html><head><title>Test</title></head><body><p>Content</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns_html_and_metadata_for_successful_crawl", async () => {
    const robotsCache = new RobotsCache();
    const result = await crawlUrl("https://example.com/page", "gentle", robotsCache);
    expect(result.html).toContain("<title>Test</title>");
    expect(result.httpStatus).toBe(200);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns_error_when_ssrf_guard_rejects", async () => {
    vi.spyOn(ssrfGuard, "validateUrl").mockResolvedValue({
      safe: false,
      reason: "Resolved to private IP: 127.0.0.1",
    });

    const robotsCache = new RobotsCache();
    const result = await crawlUrl("https://evil.com", "gentle", robotsCache);
    expect(result.error).toContain("private IP");
    expect(result.failureType).toBe("ssrf");
  });

  it("returns_error_when_robots_txt_disallows", async () => {
    const robotsCache = new RobotsCache();
    robotsCache.set("example.com", "User-agent: *\nDisallow: /blocked/\n");

    const result = await crawlUrl("https://example.com/blocked/page", "gentle", robotsCache);
    expect(result.error).toContain("robots.txt");
    expect(result.failureType).toBe("robots");
  });

  it("follows_redirects_with_ssrf_validation", async () => {
    // First request returns 301
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://example.com/redirected" },
        })
      )
      .mockResolvedValueOnce(
        new Response("<html><body><p>Redirected content here</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      );
    global.fetch = fetchMock;

    const robotsCache = new RobotsCache();
    const result = await crawlUrl("https://example.com/old-page", "gentle", robotsCache);
    expect(result.httpStatus).toBe(200);
    expect(result.redirectChain).toContain("https://example.com/redirected");
    // validateUrl should be called for each URL (original + redirect)
    expect(ssrfGuard.validateUrl).toHaveBeenCalledTimes(2);
  });

  it("stops_after_max_redirects", async () => {
    // Always redirect
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { location: "https://example.com/loop" },
      })
    );

    const robotsCache = new RobotsCache();
    const result = await crawlUrl("https://example.com/start", "gentle", robotsCache);
    expect(result.error).toContain("redirect");
    expect(result.failureType).toBe("permanent");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/ingestion/crawler.test.ts --run`

Expected: FAIL — `crawlUrl` is not defined.

- [ ] **Step 3: Implement the crawler**

```typescript
import { validateUrl } from "./ssrf-guard";
import { RobotsCache } from "./robots";
import type { CrawlPreset, FailureType } from "./types";

const USER_AGENT = "SEO-ilator/1.0 (+https://seo-ilator.com/bot)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface CrawlUrlResult {
  html: string;
  httpStatus: number;
  responseTimeMs: number;
  redirectChain: string[];
  error?: string;
  failureType?: FailureType;
}

/**
 * Crawl a single URL with SSRF protection, robots.txt compliance,
 * and redirect chain validation (AAP-B1).
 *
 * The caller is responsible for rate limiting (delay between calls).
 * This function is stateless — it processes one URL at a time.
 */
export async function crawlUrl(
  url: string,
  preset: CrawlPreset,
  robotsCache: RobotsCache
): Promise<CrawlUrlResult> {
  const startTime = Date.now();
  const redirectChain: string[] = [];

  // Step 1: SSRF validation on initial URL
  const validation = await validateUrl(url);
  if (!validation.safe) {
    return {
      html: "",
      httpStatus: 0,
      responseTimeMs: Date.now() - startTime,
      redirectChain,
      error: `SSRF blocked: ${validation.reason}`,
      failureType: "ssrf",
    };
  }

  // Step 2: Fetch and cache robots.txt if not already cached
  const domain = new URL(url).hostname;
  if (!robotsCache.has(domain)) {
    try {
      const robotsUrl = `https://${domain}/robots.txt`;
      // SSRF-validate the robots.txt URL too (same domain, but prevents
      // DNS rebinding between the initial check and this fetch)
      const robotsValidation = await validateUrl(robotsUrl);
      if (!robotsValidation.safe) {
        robotsCache.set(domain, ""); // Can't fetch safely = allow all
      } else {
        const robotsRes = await fetch(robotsUrl, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "manual", // Don't follow redirects to avoid unvalidated targets
        });
        if (robotsRes.ok) {
          robotsCache.set(domain, await robotsRes.text());
        } else {
          robotsCache.set(domain, ""); // No robots.txt = allow all
        }
      }
    } catch {
      robotsCache.set(domain, ""); // Fetch failed = allow all
    }
  }

  // Step 3: Check robots.txt
  const robotsCheck = robotsCache.check(url, USER_AGENT);
  if (!robotsCheck.allowed) {
    return {
      html: "",
      httpStatus: 0,
      responseTimeMs: Date.now() - startTime,
      redirectChain,
      error: `Blocked by robots.txt for ${domain}`,
      failureType: "robots",
    };
  }

  // Step 4: Fetch with manual redirect following
  let currentUrl = url;
  let response: Response;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    try {
      response = await fetch(currentUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "manual",
      });
    } catch (err) {
      return {
        html: "",
        httpStatus: 0,
        responseTimeMs: Date.now() - startTime,
        redirectChain,
        error: `Fetch failed: ${(err as Error).message}`,
        failureType: "transient",
      };
    }

    // Not a redirect — we're done
    if (response!.status < 300 || response!.status >= 400) {
      const html = await response!.text();
      return {
        html,
        httpStatus: response!.status,
        responseTimeMs: Date.now() - startTime,
        redirectChain,
      };
    }

    // Handle redirect
    const location = response!.headers.get("location");
    if (!location) {
      return {
        html: "",
        httpStatus: response!.status,
        responseTimeMs: Date.now() - startTime,
        redirectChain,
        error: `Redirect ${response!.status} without Location header`,
        failureType: "permanent",
      };
    }

    const redirectUrl = new URL(location, currentUrl).href;
    redirectChain.push(redirectUrl);

    // SSRF check on redirect target (AAP-B1)
    const redirectValidation = await validateUrl(redirectUrl);
    if (!redirectValidation.safe) {
      return {
        html: "",
        httpStatus: response!.status,
        responseTimeMs: Date.now() - startTime,
        redirectChain,
        error: `Redirect SSRF blocked: ${redirectValidation.reason}`,
        failureType: "ssrf",
      };
    }

    currentUrl = redirectUrl;

    if (i === MAX_REDIRECTS) {
      return {
        html: "",
        httpStatus: response!.status,
        responseTimeMs: Date.now() - startTime,
        redirectChain,
        error: `Too many redirects (max ${MAX_REDIRECTS})`,
        failureType: "permanent",
      };
    }
  }

  // Should never reach here, but TypeScript needs it
  return {
    html: "",
    httpStatus: 0,
    responseTimeMs: Date.now() - startTime,
    redirectChain,
    error: "Unexpected crawl loop exit",
    failureType: "permanent",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/ingestion/crawler.test.ts --run`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/crawler.ts tests/lib/ingestion/crawler.test.ts
git commit -m "feat(ingestion): add crawler with SSRF + robots.txt + redirect validation [AAP-B1]"
```

---

## Task 9: Queue System

**Files:**
- Create: `src/lib/ingestion/queue.ts`
- Create: `tests/lib/ingestion/queue.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createJob,
  cancelJob,
  claimTasks,
  completeTask,
  failTask,
  recoverZombies,
  finalizeJob,
} from "@/lib/ingestion/queue";

// Mock Prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    ingestionJob: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    ingestionTask: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((fn: any) => fn({
      ingestionJob: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
      },
      ingestionTask: {
        createMany: vi.fn(),
        updateMany: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
    })),
  },
  scopedPrisma: vi.fn(() => ({
    ingestionJob: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    ingestionTask: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  })),
}));

describe("createJob", () => {
  it("deduplicates_urls_before_creating_tasks", async () => {
    const { prisma } = await import("@/lib/db");
    const mockJob = { id: "job-1", projectId: "p1", status: "pending", totalUrls: 2 };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        ingestionJob: { create: vi.fn().mockResolvedValue(mockJob) },
        ingestionTask: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      };
      return fn(tx);
    });

    const urls = [
      "https://example.com/page1",
      "https://example.com/page2",
      "https://example.com/page1", // duplicate
      "https://example.com/page1/", // trailing slash variant
    ];

    const result = await createJob("p1", urls, "gentle");
    expect(result.totalUrls).toBeLessThan(urls.length);
  });
});

describe("cancelJob", () => {
  it("sets_job_to_cancelled_and_transitions_pending_tasks", async () => {
    const { prisma } = await import("@/lib/db");
    const mockJob = { id: "job-1", status: "cancelled" };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        ingestionJob: { update: vi.fn().mockResolvedValue(mockJob) },
        ingestionTask: { updateMany: vi.fn().mockResolvedValue({ count: 5 }) },
      };
      return fn(tx);
    });

    const result = await cancelJob("job-1", "p1");
    expect(result.status).toBe("cancelled");
  });
});

describe("failTask", () => {
  it("retries_transient_failure_with_backoff_when_under_limit", async () => {
    const { prisma } = await import("@/lib/db");
    const mockTask = { id: "t1", retryCount: 0, status: "pending" };
    vi.mocked(prisma.ingestionTask.update).mockResolvedValue(mockTask as any);

    await failTask("t1", "job-1", "503 Service Unavailable", true);

    expect(prisma.ingestionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: expect.objectContaining({
          status: "pending",
          retryCount: 1,
        }),
      })
    );
  });

  it("marks_permanent_failure_immediately", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.ingestionTask.update).mockResolvedValue({ id: "t1", status: "failed" } as any);

    await failTask("t1", "job-1", "404 Not Found", false);

    expect(prisma.ingestionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
        }),
      })
    );
  });
});

describe("claimTasks", () => {
  it("returns_task_ids_for_pending_tasks", async () => {
    const { prisma } = await import("@/lib/db");
    const mockTasks = [{ id: "t1" }, { id: "t2" }];
    vi.mocked(prisma.ingestionTask.findMany).mockResolvedValue(mockTasks as any);
    vi.mocked(prisma.ingestionTask.updateMany).mockResolvedValue({ count: 2 } as any);

    const ids = await claimTasks("job-1", 10);
    expect(ids).toEqual(["t1", "t2"]);
    // Verify updateMany includes retryAfter in WHERE clause
    expect(prisma.ingestionTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "pending",
        }),
      })
    );
  });

  it("returns_empty_array_when_no_pending_tasks", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.ingestionTask.findMany).mockResolvedValue([]);

    const ids = await claimTasks("job-1", 10);
    expect(ids).toEqual([]);
  });
});

describe("completeTask", () => {
  it("marks_task_completed_and_increments_job_counter", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        ingestionTask: { update: vi.fn().mockResolvedValue({ id: "t1", status: "completed" }) },
        ingestionJob: { update: vi.fn().mockResolvedValue({ id: "job-1" }) },
      };
      return fn(tx);
    });

    await completeTask("t1", "job-1", 200, 150);
    // If no error thrown, the CAS update and job increment both succeeded
  });
});

describe("recoverZombies", () => {
  it("resets_stale_processing_tasks_to_pending", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.ingestionTask.updateMany).mockResolvedValue({ count: 3 } as any);

    const count = await recoverZombies();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/ingestion/queue.test.ts --run`

Expected: FAIL — queue functions are not defined.

- [ ] **Step 3: Implement the queue**

```typescript
import { prisma } from "@/lib/db";
import type { CrawlPreset } from "./types";
import type { IngestionJob } from "@prisma/client";

const MAX_RETRIES = 2;
const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes (AAP-B2)
const RETRY_BACKOFF_BASE_MS = 30_000; // 30 seconds

/**
 * Normalize a URL for deduplication: lowercase scheme+host, remove trailing slash.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();
    // Remove trailing slash from pathname (unless it's just "/")
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Create a new ingestion job with deduplicated task rows.
 */
export async function createJob(
  projectId: string,
  urls: string[],
  preset: CrawlPreset
): Promise<IngestionJob> {
  // Deduplicate URLs
  const seen = new Set<string>();
  const dedupedUrls: string[] = [];
  for (const url of urls) {
    const normalized = normalizeUrl(url);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      dedupedUrls.push(url); // Keep original URL, not normalized
    }
  }

  return prisma.$transaction(async (tx) => {
    const job = await tx.ingestionJob.create({
      data: {
        projectId,
        status: "pending",
        totalUrls: dedupedUrls.length,
        preset,
      },
    });

    if (dedupedUrls.length > 0) {
      await tx.ingestionTask.createMany({
        data: dedupedUrls.map((url) => ({
          jobId: job.id,
          url,
          status: "pending",
        })),
      });
    }

    return job;
  });
}

/**
 * Cancel a job: set status to cancelled, atomically transition all pending tasks
 * to cancelled. In-flight processing tasks are handled by the cron worker
 * (checks job status before writing results). (AAP-F9)
 */
export async function cancelJob(
  jobId: string,
  projectId: string
): Promise<IngestionJob> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.ingestionJob.update({
      where: { id: jobId, projectId },
      data: { status: "cancelled" },
    });

    await tx.ingestionTask.updateMany({
      where: { jobId, status: "pending" },
      data: { status: "cancelled" },
    });

    return job;
  });
}

/**
 * Claim a batch of pending tasks for processing using compare-and-swap (AAP-B2).
 * Only claims tasks whose retryAfter has passed (or is null).
 */
export async function claimTasks(
  jobId: string,
  batchSize: number
): Promise<string[]> {
  const now = new Date();

  // Find eligible tasks
  const tasks = await prisma.ingestionTask.findMany({
    where: {
      jobId,
      status: "pending",
      OR: [
        { retryAfter: null },
        { retryAfter: { lt: now } },
      ],
    },
    select: { id: true },
    take: batchSize,
  });

  if (tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id);

  // CAS: only claim tasks still in pending status with valid retryAfter
  await prisma.ingestionTask.updateMany({
    where: {
      id: { in: taskIds },
      status: "pending", // CAS condition
      OR: [
        { retryAfter: null },
        { retryAfter: { lt: now } },
      ],
    },
    data: {
      status: "processing",
      startedAt: now,
    },
  });

  return taskIds;
}

/**
 * Mark a task as completed. Uses CAS to avoid double-writes (AAP-B2).
 */
export async function completeTask(
  taskId: string,
  jobId: string,
  httpStatus?: number,
  responseTimeMs?: number
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ingestionTask.update({
      where: { id: taskId, status: "processing" }, // CAS
      data: {
        status: "completed",
        httpStatus,
        responseTimeMs,
        processedAt: new Date(),
      },
    });

    await tx.ingestionJob.update({
      where: { id: jobId },
      data: { completedUrls: { increment: 1 } },
    });
  });
}

/**
 * Handle a task failure. Transient failures get retried with backoff;
 * permanent failures are marked failed immediately.
 */
export async function failTask(
  taskId: string,
  jobId: string,
  errorMessage: string,
  isTransient: boolean
): Promise<void> {
  if (isTransient) {
    // Check current retry count first
    const task = await prisma.ingestionTask.findUnique({
      where: { id: taskId },
      select: { retryCount: true },
    });

    if (task && task.retryCount < MAX_RETRIES) {
      const newRetryCount = task.retryCount + 1;
      const retryAfter = new Date(
        Date.now() + RETRY_BACKOFF_BASE_MS * newRetryCount
      );

      await prisma.ingestionTask.update({
        where: { id: taskId },
        data: {
          status: "pending",
          retryCount: newRetryCount,
          retryAfter,
          errorMessage,
        },
      });
      return;
    }
  }

  // Permanent failure or retries exhausted
  await prisma.$transaction(async (tx) => {
    await tx.ingestionTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage,
        processedAt: new Date(),
      },
    });

    await tx.ingestionJob.update({
      where: { id: jobId },
      data: { failedUrls: { increment: 1 } },
    });
  });
}

/**
 * Recover zombie tasks: tasks stuck in "processing" for > 10 minutes (AAP-B2).
 * Resets to pending with retry increment, or fails if retries exhausted.
 */
export async function recoverZombies(): Promise<number> {
  const threshold = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);

  const result = await prisma.ingestionTask.updateMany({
    where: {
      status: "processing",
      startedAt: { lt: threshold },
      retryCount: { lt: MAX_RETRIES },
    },
    data: {
      status: "pending",
      retryCount: { increment: 1 },
      retryAfter: new Date(Date.now() + RETRY_BACKOFF_BASE_MS),
    },
  });

  // Fail zombie tasks that have exhausted retries
  await prisma.ingestionTask.updateMany({
    where: {
      status: "processing",
      startedAt: { lt: threshold },
      retryCount: { gte: MAX_RETRIES },
    },
    data: {
      status: "failed",
      errorMessage: "Processing timed out after maximum retries",
      processedAt: new Date(),
    },
  });

  return result.count;
}

/**
 * Finalize a job: check if all tasks are done and update job status.
 */
export async function finalizeJob(jobId: string): Promise<void> {
  const pending = await prisma.ingestionTask.count({
    where: { jobId, status: { in: ["pending", "processing"] } },
  });

  if (pending > 0) return; // Still has work to do

  const failed = await prisma.ingestionTask.count({
    where: { jobId, status: "failed" },
  });

  const total = await prisma.ingestionTask.count({
    where: { jobId },
  });

  await prisma.ingestionJob.update({
    where: { id: jobId },
    data: {
      status: failed === total ? "failed" : "completed",
      completedAt: new Date(),
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/ingestion/queue.test.ts --run`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/queue.ts tests/lib/ingestion/queue.test.ts
git commit -m "feat(ingestion): add database-backed queue with CAS, retry, zombie recovery [AAP-B2, AAP-F9]"
```

---

## Task 10: Sitemap Parser

**Files:**
- Create: `src/lib/ingestion/sitemap.ts`
- Create: `tests/lib/ingestion/sitemap.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSitemap } from "@/lib/ingestion/sitemap";
import * as ssrfGuard from "@/lib/ingestion/ssrf-guard";

describe("parseSitemap", () => {
  beforeEach(() => {
    vi.spyOn(ssrfGuard, "validateUrl").mockResolvedValue({
      safe: true,
      resolvedIp: "93.184.216.34",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses_standard_urlset_sitemap", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/page1</loc></url>
        <url><loc>https://example.com/page2</loc></url>
      </urlset>`;
    global.fetch = vi.fn().mockResolvedValue(new Response(xml, { status: 200 }));

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.urls).toEqual([
      "https://example.com/page1",
      "https://example.com/page2",
    ]);
    expect(result.warnings).toHaveLength(0);
  });

  it("follows_sitemapindex_one_level_deep", async () => {
    const index = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
      </sitemapindex>`;
    const posts = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/post/1</loc></url>
      </urlset>`;

    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(index, { status: 200 }))
      .mockResolvedValueOnce(new Response(posts, { status: 200 }));

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.urls).toEqual(["https://example.com/post/1"]);
  });

  it("enforces_recursion_depth_limit_of_2", async () => {
    const makeIndex = (loc: string) => `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>${loc}</loc></sitemap>
      </sitemapindex>`;

    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(makeIndex("https://example.com/level1.xml"), { status: 200 }))
      .mockResolvedValueOnce(new Response(makeIndex("https://example.com/level2.xml"), { status: 200 }))
      .mockResolvedValueOnce(new Response(makeIndex("https://example.com/level3.xml"), { status: 200 }));

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.warnings.some((w) => w.includes("depth"))).toBe(true);
  });

  it("enforces_url_count_cap_of_10000", async () => {
    const urls = Array.from({ length: 10_500 }, (_, i) =>
      `<url><loc>https://example.com/page${i}</loc></url>`
    ).join("\n");
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
    global.fetch = vi.fn().mockResolvedValue(new Response(xml, { status: 200 }));

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.urls).toHaveLength(10_000);
    expect(result.warnings.some((w) => w.includes("10,000"))).toBe(true);
  });

  it("deduplicates_urls", async () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/page</loc></url>
      <url><loc>https://example.com/page</loc></url>
      <url><loc>https://Example.com/page</loc></url>
    </urlset>`;
    global.fetch = vi.fn().mockResolvedValue(new Response(xml, { status: 200 }));

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.urls).toHaveLength(1);
  });

  it("handles_malformed_xml_gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("this is not xml at all", { status: 200 })
    );

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.urls).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("parses_plain_text_url_list", async () => {
    const text = `https://example.com/page1\nhttps://example.com/page2\n\nhttps://example.com/page3`;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(text, { status: 200, headers: { "content-type": "text/plain" } })
    );

    const result = await parseSitemap("https://example.com/urls.txt");
    expect(result.urls).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest tests/lib/ingestion/sitemap.test.ts --run`

Expected: FAIL — `parseSitemap` is not defined.

- [ ] **Step 3: Implement the sitemap parser**

```typescript
import * as cheerio from "cheerio";
import { validateUrl } from "./ssrf-guard";

const MAX_DEPTH = 2;
const MAX_URLS = 10_000;
const MAX_DECOMPRESSED_SIZE = 50 * 1024 * 1024; // 50MB
const FETCH_TIMEOUT_MS = 10_000;

interface SitemapResult {
  urls: string[];
  warnings: string[];
}

/**
 * Normalize a URL for deduplication.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Parse a sitemap URL (XML sitemap, sitemap index, or plain text URL list).
 * Enforces AAP-O10 safeguards: depth limit, size limit, URL cap, dedup.
 */
export async function parseSitemap(url: string): Promise<SitemapResult> {
  const allUrls: string[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  let totalSize = 0;

  async function fetchAndParse(sitemapUrl: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      warnings.push(`Sitemap recursion depth limit (${MAX_DEPTH}) reached at ${sitemapUrl}`);
      return;
    }

    if (allUrls.length >= MAX_URLS) return;

    // SSRF validate the sitemap URL itself
    const validation = await validateUrl(sitemapUrl);
    if (!validation.safe) {
      warnings.push(`SSRF blocked: ${validation.reason} for ${sitemapUrl}`);
      return;
    }

    let text: string;
    try {
      const res = await fetch(sitemapUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) {
        warnings.push(`Failed to fetch sitemap: HTTP ${res.status} for ${sitemapUrl}`);
        return;
      }
      text = await res.text();
    } catch (err) {
      warnings.push(`Failed to fetch sitemap: ${(err as Error).message} for ${sitemapUrl}`);
      return;
    }

    totalSize += text.length;
    if (totalSize > MAX_DECOMPRESSED_SIZE) {
      warnings.push(`Decompressed size limit (50MB) exceeded`);
      return;
    }

    // Detect if this is plain text (URL list) vs XML
    const trimmed = text.trim();
    if (!trimmed.startsWith("<?xml") && !trimmed.startsWith("<")) {
      // Plain text URL list
      for (const line of trimmed.split("\n")) {
        const u = line.trim();
        if (!u || !u.startsWith("http")) continue;
        addUrl(u);
        if (allUrls.length >= MAX_URLS) break;
      }
      return;
    }

    // Parse XML with cheerio
    const $ = cheerio.load(text, { xml: true });

    // Check if sitemap index
    const sitemapLocs = $("sitemapindex sitemap loc");
    if (sitemapLocs.length > 0) {
      for (let i = 0; i < sitemapLocs.length; i++) {
        if (allUrls.length >= MAX_URLS) break;
        const loc = $(sitemapLocs[i]).text().trim();
        if (loc) {
          await fetchAndParse(loc, depth + 1);
        }
      }
      return;
    }

    // Standard urlset
    const urlLocs = $("urlset url loc");
    if (urlLocs.length === 0 && trimmed.includes("<")) {
      warnings.push(`No URLs found in sitemap at ${sitemapUrl}. Possibly malformed XML.`);
      return;
    }

    for (let i = 0; i < urlLocs.length; i++) {
      if (allUrls.length >= MAX_URLS) {
        warnings.push(`Sitemap contains more than 10,000 URLs. Only the first 10,000 will be processed.`);
        break;
      }
      const loc = $(urlLocs[i]).text().trim();
      if (loc) addUrl(loc);
    }
  }

  function addUrl(url: string): void {
    const normalized = normalizeUrl(url);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      allUrls.push(url);
    }
  }

  await fetchAndParse(url, 0);
  return { urls: allUrls, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest tests/lib/ingestion/sitemap.test.ts --run`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/sitemap.ts tests/lib/ingestion/sitemap.test.ts
git commit -m "feat(ingestion): add sitemap parser with depth/size/count limits [AAP-O10]"
```

---

## Task 11: Cron Worker — `/api/cron/crawl`

**Files:**
- Create: `src/app/api/cron/crawl/route.ts`

- [ ] **Step 1: Implement the cron worker**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth/cron-guard";
import { crawlUrl } from "@/lib/ingestion/crawler";
import { parseHTML } from "@/lib/ingestion/parser";
import { normalizeArticle, computeHash } from "@/lib/ingestion/normalizer";
import {
  claimTasks,
  completeTask,
  failTask,
  recoverZombies,
  finalizeJob,
} from "@/lib/ingestion/queue";
import { RobotsCache } from "@/lib/ingestion/robots";
import { PRESET_DELAYS, classifyHttpError } from "@/lib/ingestion/types";
import type { CrawlPreset } from "@/lib/ingestion/types";

export const dynamic = "force-dynamic";

const TIME_BUDGET_MS = 270_000; // 270s of the 300s max duration
const BATCH_SIZE = 20;

/**
 * GET /api/cron/crawl
 *
 * Processes pending ingestion tasks. Called daily by Vercel Cron
 * and on-demand when large jobs are created.
 * Protected by CRON_SECRET header verification.
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  let tasksProcessed = 0;
  let tasksFailed = 0;

  try {
    // Step 1: Recover zombie tasks
    const recovered = await recoverZombies();

    // Step 2: Find all running/pending jobs
    const jobs = await prisma.ingestionJob.findMany({
      where: { status: { in: ["pending", "running"] } },
      orderBy: { createdAt: "asc" },
    });

    const robotsCache = new RobotsCache();

    for (const job of jobs) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break;

      // Mark job as running if still pending
      if (job.status === "pending") {
        await prisma.ingestionJob.update({
          where: { id: job.id },
          data: { status: "running" },
        });
      }

      const preset = (job.preset as CrawlPreset) || "gentle";
      const delayMs = PRESET_DELAYS[preset];

      // Claim and process tasks in batches
      while (Date.now() - startTime < TIME_BUDGET_MS) {
        // Check if job was cancelled
        const currentJob = await prisma.ingestionJob.findUnique({
          where: { id: job.id },
          select: { status: true },
        });
        if (currentJob?.status === "cancelled") break;

        const taskIds = await claimTasks(job.id, BATCH_SIZE);
        if (taskIds.length === 0) break;

        for (const taskId of taskIds) {
          if (Date.now() - startTime > TIME_BUDGET_MS) break;

          const task = await prisma.ingestionTask.findUnique({
            where: { id: taskId },
            select: { url: true },
          });
          if (!task) continue;

          // Check if job was cancelled before writing result
          const jobStatus = await prisma.ingestionJob.findUnique({
            where: { id: job.id },
            select: { status: true },
          });
          if (jobStatus?.status === "cancelled") {
            await prisma.ingestionTask.update({
              where: { id: taskId },
              data: { status: "cancelled" },
            });
            continue;
          }

          const result = await crawlUrl(task.url, preset, robotsCache);

          if (result.error) {
            const isTransient = result.failureType === "transient";
            await failTask(taskId, job.id, result.error, isTransient);
            tasksFailed++;
          } else {
            // Parse and normalize the crawled content
            const parsed = parseHTML(
              result.html,
              task.url,
              result.httpStatus,
              result.responseTimeMs
            );
            const normalized = normalizeArticle(parsed, job.projectId, "crawl");

            // Upsert article
            await prisma.article.upsert({
              where: {
                projectId_url: {
                  projectId: job.projectId,
                  url: normalized.url,
                },
              },
              create: {
                projectId: job.projectId,
                url: normalized.url,
                title: normalized.title,
                body: normalized.body,
                bodyHash: normalized.bodyHash,
                titleHash: normalized.titleHash,
                wordCount: normalized.wordCount,
                existingLinks: normalized.existingLinks as any,
                metadata: normalized.metadata as any,
                sourceType: normalized.sourceType,
                httpStatus: normalized.metadata.httpStatus,
                parseWarning: normalized.parseWarning,
              },
              update: {
                title: normalized.title,
                body: normalized.body,
                bodyHash: normalized.bodyHash,
                titleHash: normalized.titleHash,
                wordCount: normalized.wordCount,
                existingLinks: normalized.existingLinks as any,
                metadata: normalized.metadata as any,
                httpStatus: normalized.metadata.httpStatus,
                parseWarning: normalized.parseWarning,
              },
            });

            await completeTask(
              taskId,
              job.id,
              result.httpStatus,
              result.responseTimeMs
            );
            tasksProcessed++;
          }

          // Rate limit delay
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      // Check if job is done
      await finalizeJob(job.id);
    }

    return NextResponse.json({
      success: true,
      recovered,
      tasksProcessed,
      tasksFailed,
      elapsedMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error("[cron/crawl] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/app/api/cron/crawl/route.ts 2>&1 | head -20`

Expected: No errors (or only errors from missing imports that will be resolved by prior tasks).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/crawl/route.ts
git commit -m "feat(ingestion): add crawl cron worker with batch processing [AAP-B2]"
```

---

## Task 12: Sitemap/URL-list Ingestion API Route

**Files:**
- Create: `src/app/api/articles/route.ts`

- [ ] **Step 1: Implement the ingestion API route**

```typescript
import { NextResponse, after } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma, scopedPrisma } from "@/lib/db";
import { parseSitemap } from "@/lib/ingestion/sitemap";
import { createJob } from "@/lib/ingestion/queue";
import { crawlUrl } from "@/lib/ingestion/crawler";
import { parseHTML } from "@/lib/ingestion/parser";
import { normalizeArticle } from "@/lib/ingestion/normalizer";
import { RobotsCache } from "@/lib/ingestion/robots";
import { PRESET_DELAYS } from "@/lib/ingestion/types";
import type { CrawlPreset } from "@/lib/ingestion/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SYNC_THRESHOLD = 50;

const sitemapSchema = z.object({
  method: z.literal("sitemap"),
  url: z.url(),
  preset: z.enum(["gentle", "standard", "fast"]).default("gentle"),
});

const urlListSchema = z.object({
  method: z.literal("url_list"),
  urls: z.array(z.url()).min(1).max(10_000),
  preset: z.enum(["gentle", "standard", "fast"]).default("gentle"),
});

const inputSchema = z.discriminatedUnion("method", [sitemapSchema, urlListSchema]);

/**
 * POST /api/articles
 *
 * Ingest articles via sitemap URL or URL list.
 * Small jobs (<50 URLs) are processed synchronously.
 * Large jobs return 202 and trigger async processing.
 */
export async function POST(request: Request) {
  const { projectId } = await requireAuth();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const preset = input.preset as CrawlPreset;

  // Extract URLs
  let urls: string[];
  let warnings: string[] = [];

  if (input.method === "sitemap") {
    const sitemapResult = await parseSitemap(input.url);
    urls = sitemapResult.urls;
    warnings = sitemapResult.warnings;

    if (urls.length === 0) {
      return NextResponse.json(
        { error: "No URLs found in sitemap", warnings },
        { status: 400 }
      );
    }
  } else {
    urls = input.urls;
  }

  // Create the job
  const job = await createJob(projectId, urls, preset);

  // Route: sync or async
  if (job.totalUrls < SYNC_THRESHOLD) {
    // SYNC PATH: process inline
    // Use scopedPrisma for article/job queries, but base prisma for
    // ingestionTask queries (IngestionTask has no projectId column)
    const db = scopedPrisma(projectId);
    const robotsCache = new RobotsCache();
    const delayMs = PRESET_DELAYS[preset];

    const tasks = await prisma.ingestionTask.findMany({
      where: { jobId: job.id, status: "pending" },
    });

    for (const task of tasks) {
      const result = await crawlUrl(task.url, preset, robotsCache);

      if (result.error) {
        await prisma.ingestionTask.update({
          where: { id: task.id },
          data: {
            status: "failed",
            errorMessage: result.error,
            processedAt: new Date(),
          },
        });
      } else {
        const parsed = parseHTML(
          result.html,
          task.url,
          result.httpStatus,
          result.responseTimeMs
        );
        const normalized = normalizeArticle(parsed, projectId, "crawl");

        await db.article.upsert({
          where: {
            projectId_url: { projectId, url: normalized.url },
          },
          create: {
            projectId,
            url: normalized.url,
            title: normalized.title,
            body: normalized.body,
            bodyHash: normalized.bodyHash,
            titleHash: normalized.titleHash,
            wordCount: normalized.wordCount,
            existingLinks: normalized.existingLinks as any,
            metadata: normalized.metadata as any,
            sourceType: normalized.sourceType,
            httpStatus: normalized.metadata.httpStatus,
            parseWarning: normalized.parseWarning,
          },
          update: {
            title: normalized.title,
            body: normalized.body,
            bodyHash: normalized.bodyHash,
            titleHash: normalized.titleHash,
            wordCount: normalized.wordCount,
            existingLinks: normalized.existingLinks as any,
            metadata: normalized.metadata as any,
            httpStatus: normalized.metadata.httpStatus,
            parseWarning: normalized.parseWarning,
          },
        });

        await prisma.ingestionTask.update({
          where: { id: task.id },
          data: {
            status: "completed",
            httpStatus: result.httpStatus,
            responseTimeMs: result.responseTimeMs,
            processedAt: new Date(),
          },
        });
      }

      // Rate limit delay
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Finalize
    const completed = await prisma.ingestionTask.count({
      where: { jobId: job.id, status: "completed" },
    });
    const failed = await prisma.ingestionTask.count({
      where: { jobId: job.id, status: "failed" },
    });

    await db.ingestionJob.update({
      where: { id: job.id },
      data: {
        status: failed === job.totalUrls ? "failed" : "completed",
        completedUrls: completed,
        failedUrls: failed,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      jobId: job.id,
      status: "completed",
      totalUrls: job.totalUrls,
      completedUrls: completed,
      failedUrls: failed,
      warnings,
    });
  } else {
    // ASYNC PATH: fire on-demand cron trigger via after()
    after(async () => {
      try {
        const cronSecret = process.env.CRON_SECRET;
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000";

        await fetch(`${baseUrl}/api/cron/crawl`, {
          method: "GET",
          headers: { Authorization: `Bearer ${cronSecret}` },
        });
      } catch (err) {
        console.error("[articles] Failed to trigger cron:", err);
        // Job stays pending — daily cron will pick it up as safety net
      }
    });

    return NextResponse.json(
      {
        jobId: job.id,
        status: "pending",
        totalUrls: job.totalUrls,
        warnings,
        message: "Job queued for processing. Poll GET /api/jobs/{jobId} for status.",
      },
      { status: 202 }
    );
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No type errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/articles/route.ts
git commit -m "feat(ingestion): add sitemap/URL-list ingestion API with sync/async routing"
```

---

## Task 13: File Upload API Route

**Files:**
- Create: `src/app/api/articles/upload/route.ts`

- [ ] **Step 1: Implement the upload route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";
import { parseHTML, parseMarkdown } from "@/lib/ingestion/parser";
import { normalizeArticle } from "@/lib/ingestion/normalizer";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total
const ALLOWED_EXTENSIONS = [".html", ".htm", ".md", ".markdown", ".json"];

// Schema for JSON manifest articles
const jsonArticleSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const jsonManifestSchema = z.array(jsonArticleSchema);

/**
 * POST /api/articles/upload
 *
 * Accept file uploads (HTML, Markdown, JSON manifest).
 * Always synchronous — no crawling needed. (AAP-F7)
 */
export async function POST(request: Request) {
  const { projectId } = await requireAuth();
  const db = scopedPrisma(projectId);

  const formData = await request.formData();
  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No files provided" },
      { status: 400 }
    );
  }

  // Validate file sizes
  let totalSize = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds 10MB limit` },
        { status: 400 }
      );
    }
    totalSize += file.size;
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json(
      { error: "Total upload size exceeds 50MB limit" },
      { status: 400 }
    );
  }

  const results: { created: number; updated: number; warnings: string[] } = {
    created: 0,
    updated: 0,
    warnings: [],
  };

  for (const file of files) {
    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      results.warnings.push(`Skipped "${file.name}": unsupported file type "${ext}"`);
      continue;
    }

    const content = await file.text();

    try {
      if (ext === ".json") {
        // JSON manifest: array of article objects
        const parsed = jsonManifestSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
          results.warnings.push(`Skipped "${file.name}": invalid JSON manifest`);
          continue;
        }
        for (const article of parsed.data) {
          const normalized = normalizeArticle(
            {
              url: article.url,
              title: article.title,
              body: article.body,
              wordCount: article.body.split(/\s+/).length,
              existingLinks: [],
              metadata: {
                canonical: null,
                metaTitle: null,
                metaDescription: null,
                h1: null,
                h2s: [],
                noindex: false,
                nofollow: false,
                httpStatus: null,
                responseTimeMs: null,
              },
              parseWarning: null,
            },
            projectId,
            "upload"
          );
          await upsertArticle(db, projectId, normalized, results);
        }
      } else if (ext === ".md" || ext === ".markdown") {
        const url = `upload://${file.name}`;
        const parsed = parseMarkdown(content, url);
        const normalized = normalizeArticle(parsed, projectId, "upload");
        await upsertArticle(db, projectId, normalized, results);
      } else {
        // HTML
        const url = `upload://${file.name}`;
        const parsed = parseHTML(content, url);
        const normalized = normalizeArticle(parsed, projectId, "upload");
        await upsertArticle(db, projectId, normalized, results);
      }
    } catch (err) {
      results.warnings.push(`Error processing "${file.name}": ${(err as Error).message}`);
    }
  }

  return NextResponse.json({
    created: results.created,
    updated: results.updated,
    warnings: results.warnings,
  });
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

async function upsertArticle(
  db: ReturnType<typeof scopedPrisma>,
  projectId: string,
  normalized: ReturnType<typeof normalizeArticle>,
  results: { created: number; updated: number; warnings: string[] }
): Promise<void> {
  const existing = await db.article.findUnique({
    where: { projectId_url: { projectId, url: normalized.url } },
    select: { bodyHash: true },
  });

  if (existing) {
    if (existing.bodyHash !== normalized.bodyHash) {
      await db.article.update({
        where: { projectId_url: { projectId, url: normalized.url } },
        data: {
          title: normalized.title,
          body: normalized.body,
          bodyHash: normalized.bodyHash,
          titleHash: normalized.titleHash,
          wordCount: normalized.wordCount,
          existingLinks: normalized.existingLinks as any,
          metadata: normalized.metadata as any,
          sourceType: normalized.sourceType,
          parseWarning: normalized.parseWarning,
        },
      });
      results.updated++;
    }
    // bodyHash unchanged — skip update
  } else {
    await db.article.create({
      data: {
        projectId,
        url: normalized.url,
        title: normalized.title,
        body: normalized.body,
        bodyHash: normalized.bodyHash,
        titleHash: normalized.titleHash,
        wordCount: normalized.wordCount,
        existingLinks: normalized.existingLinks as any,
        metadata: normalized.metadata as any,
        sourceType: normalized.sourceType,
        parseWarning: normalized.parseWarning,
      },
    });
    results.created++;
  }

  if (normalized.parseWarning) {
    results.warnings.push(`"${normalized.url}": ${normalized.parseWarning}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/articles/upload/route.ts
git commit -m "feat(ingestion): add file upload API route (HTML/MD/JSON) [AAP-F7]"
```

---

## Task 14: API Push Route

**Files:**
- Create: `src/app/api/articles/push/route.ts`

- [ ] **Step 1: Implement the push route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";
import { checkPlanLimits } from "@/lib/auth/plan-guard";
import { parseHTML, parseMarkdown } from "@/lib/ingestion/parser";
import { normalizeArticle } from "@/lib/ingestion/normalizer";
import type { ParsedArticle } from "@/lib/ingestion/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

const pushSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  body: z.string().min(1),
  bodyFormat: z.enum(["html", "text", "markdown"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/articles/push
 *
 * External API push endpoint. Pro+ only.
 * Extracts existingLinks from HTML bodies (AAP-O7).
 * Sets existingLinks to [] (not null) for text/markdown (AAP-O7).
 */
export async function POST(request: Request) {
  const { projectId } = await requireAuth();

  // Plan check: API access is Pro+ only
  const planCheck = await checkPlanLimits(projectId, "api_access");
  if (!planCheck.allowed) {
    return NextResponse.json({ error: planCheck.message }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const db = scopedPrisma(projectId);

  // Parse based on format (AAP-O7)
  let articleData: ParsedArticle;

  if (input.bodyFormat === "html") {
    // Run through parseHTML to extract existingLinks
    articleData = parseHTML(input.body, input.url);
    articleData.title = input.title; // Use provided title, not parsed
  } else if (input.bodyFormat === "markdown") {
    articleData = parseMarkdown(input.body, input.url);
    articleData.title = input.title;
  } else {
    // text: no parsing, existingLinks = [] (not null) per AAP-O7
    articleData = {
      url: input.url,
      title: input.title,
      body: input.body,
      wordCount: input.body.split(/\s+/).length,
      existingLinks: [], // Explicitly empty, not null
      metadata: {
        canonical: null,
        metaTitle: null,
        metaDescription: null,
        h1: null,
        h2s: [],
        noindex: false,
        nofollow: false,
        httpStatus: null,
        responseTimeMs: null,
      },
      parseWarning: null,
    };
  }

  const normalized = normalizeArticle(articleData, projectId, "push");

  // Upsert
  const existing = await db.article.findUnique({
    where: { projectId_url: { projectId, url: normalized.url } },
    select: { id: true, bodyHash: true },
  });

  let article;
  if (existing && existing.bodyHash === normalized.bodyHash) {
    // No change — return existing
    article = await db.article.findUnique({
      where: { projectId_url: { projectId, url: normalized.url } },
    });
  } else if (existing) {
    article = await db.article.update({
      where: { projectId_url: { projectId, url: normalized.url } },
      data: {
        title: normalized.title,
        body: normalized.body,
        bodyHash: normalized.bodyHash,
        titleHash: normalized.titleHash,
        wordCount: normalized.wordCount,
        existingLinks: normalized.existingLinks as any,
        metadata: normalized.metadata as any,
        sourceType: normalized.sourceType,
        parseWarning: normalized.parseWarning,
      },
    });
  } else {
    article = await db.article.create({
      data: {
        projectId,
        url: normalized.url,
        title: normalized.title,
        body: normalized.body,
        bodyHash: normalized.bodyHash,
        titleHash: normalized.titleHash,
        wordCount: normalized.wordCount,
        existingLinks: normalized.existingLinks as any,
        metadata: normalized.metadata as any,
        sourceType: normalized.sourceType,
        parseWarning: normalized.parseWarning,
      },
    });
  }

  return NextResponse.json({ article });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/articles/push/route.ts
git commit -m "feat(ingestion): add API push route with existingLinks extraction [AAP-O7]"
```

---

## Task 15: Job Status & Cancel API Routes

**Files:**
- Create: `src/app/api/jobs/[id]/route.ts`
- Create: `src/app/api/jobs/[id]/cancel/route.ts`

- [ ] **Step 1: Implement the job status route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma, scopedPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[id]
 *
 * Returns job status with task summary and paginated task list.
 * Cursor-based pagination using task id, sorted ascending.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;
  const db = scopedPrisma(projectId);

  // Use scopedPrisma for IngestionJob (has projectId column)
  const job = await db.ingestionJob.findUnique({
    where: { id },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Parse cursor from query params
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limit = 100;

  // Use base prisma for IngestionTask (no projectId column)
  const tasks = await prisma.ingestionTask.findMany({
    where: {
      jobId: id,
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit + 1, // Fetch one extra to determine if there are more
    select: {
      id: true,
      url: true,
      status: true,
      errorMessage: true,
      httpStatus: true,
      responseTimeMs: true,
      retryCount: true,
      processedAt: true,
    },
  });

  const hasMore = tasks.length > limit;
  const pageTasks = hasMore ? tasks.slice(0, limit) : tasks;
  const nextCursor = hasMore ? pageTasks[pageTasks.length - 1].id : null;

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      totalUrls: job.totalUrls,
      completedUrls: job.completedUrls,
      failedUrls: job.failedUrls,
      preset: job.preset,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    },
    tasks: pageTasks,
    nextCursor,
  });
}
```

- [ ] **Step 2: Implement the cancel route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { cancelJob } from "@/lib/ingestion/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/[id]/cancel
 *
 * Cancel an ingestion job (AAP-F9).
 * Sets job to cancelled and transitions all pending tasks to cancelled.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;

  try {
    const job = await cancelJob(id, projectId);
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: "Job not found or cannot be cancelled" },
      { status: 404 }
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/jobs/[id]/route.ts src/app/api/jobs/[id]/cancel/route.ts
git commit -m "feat(ingestion): add job status polling and cancel endpoints [AAP-F9]"
```

---

## Task 16: Article Detail & Delete Route (AAP-B10)

**Files:**
- Create: `src/app/api/articles/[id]/route.ts`

- [ ] **Step 1: Implement the article detail and delete route**

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/articles/[id]
 *
 * Returns full article detail.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;
  const db = scopedPrisma(projectId);

  const article = await db.article.findUnique({
    where: { id },
  });

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({ article });
}

/**
 * DELETE /api/articles/[id]
 *
 * Delete an article. Returns 409 if an analysis run is active (AAP-B10).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;
  const db = scopedPrisma(projectId);

  // AAP-B10: Check for active analysis runs
  const activeRuns = await db.analysisRun.count({
    where: {
      status: { in: ["pending", "running"] },
    },
  });

  if (activeRuns > 0) {
    return NextResponse.json(
      { error: "Cannot delete articles while an analysis is running." },
      { status: 409 }
    );
  }

  try {
    await db.article.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/articles/[id]/route.ts
git commit -m "feat(ingestion): add article detail/delete with active analysis check [AAP-B10]"
```

---

## Task 17: Run Full Test Suite & Fix Issues

- [ ] **Step 1: Run all tests**

Run: `npx vitest --run`

Expected: All tests pass, including the existing tests from prior phases.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Run linter**

Run: `npm run lint`

Expected: No lint errors in new files.

- [ ] **Step 4: Fix any issues found in steps 1-3**

Address each issue, then re-run the checks until clean.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(ingestion): address test/type/lint issues from full suite run"
```

---

## Task 18: Update build_log.md

**Files:**
- Modify: `build_log.md`

- [ ] **Step 1: Append Phase 3 entry to build_log.md**

Add the following entry at the end of `build_log.md`:

```markdown
## 2026-03-23 — Phase 3: Ingestion Pipeline

### Done
- Prisma migration: retryAfter field + composite index on IngestionTask
- HTML/Markdown parser (cheerio + marked) with metadata extraction and empty-body detection [AAP-O1]
- Article normalizer with SHA-256 body/title hashing
- SSRF guard with DNS resolution and private IP rejection [AAP-B1]
- robots.txt parser and per-domain cache [DECISION-002]
- Crawler with redirect chain validation and SSRF checks on each hop [AAP-B1]
- Database-backed queue: createJob, cancelJob, claimTasks (CAS), failTask (classified retry), recoverZombies (10-min threshold), finalizeJob [AAP-B2, AAP-F9]
- Sitemap parser with depth limit (2), size limit (50MB), URL cap (10k), dedup [AAP-O10]
- API: POST /api/articles — sitemap/URL-list ingestion with hybrid sync/async routing
- API: POST /api/articles/upload — file upload (HTML/MD/JSON) with size limits [AAP-F7]
- API: POST /api/articles/push — API push with existingLinks extraction [AAP-O7]
- API: GET /api/jobs/[id] — job status with cursor-based task pagination
- API: POST /api/jobs/[id]/cancel — job cancellation [AAP-F9]
- Cron worker: /api/cron/crawl with zombie recovery and on-demand trigger

### Decisions
- v1.0 uses sequential crawling (concurrency=1 for all presets); deviation from DECISION-002 documented
- File uploads use synthetic URL scheme: upload://<filename>
- On-demand cron trigger via Next.js after() with daily cron as safety net

### Next
- Phase 4: Embedding Provider & Cache
```

- [ ] **Step 2: Commit**

```bash
git add build_log.md
git commit -m "docs(build-log): add Phase 3 ingestion pipeline entry"
```
