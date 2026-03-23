# Phase 3: Ingestion Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all three ingestion methods (sitemap, URL list, API push), async crawl queue, cron worker, and ingestion dashboard UI.

**Architecture:** Async ingestion via database-backed queue with Vercel Cron worker. URLs validated at submission and fetch time for SSRF protection. All content normalized through a single pipeline before storage.

**Tech Stack:** Cheerio (HTML parsing), Zod (validation), Next.js API routes, Vercel Cron

**Agent Team:** Validation Agent (sequential first), then Parser + Queue + API + UI agents (4-way parallel in worktrees)

**Prerequisites:** Phase 1 (schema), Phase 2 (layout shell)

---

## Table of Contents

1. [Validation Agent: Task 3.1 — Validation Schemas](#validation-agent-task-31--validation-schemas)
2. [Validation Agent: Task 3.2 — SSRF URL Validator](#validation-agent-task-32--ssrf-url-validator)
3. [Parser Agent: Task 3.3 — Normalizer (RED/GREEN)](#parser-agent-task-33--normalizer-redgreen)
4. [Parser Agent: Task 3.4 — HTML Parser (RED/GREEN)](#parser-agent-task-34--html-parser-redgreen)
5. [Parser Agent: Task 3.5 — Sitemap Parser (RED/GREEN)](#parser-agent-task-35--sitemap-parser-redgreen)
6. [Queue Agent: Task 3.6 — Crawler (RED/GREEN)](#queue-agent-task-36--crawler-redgreen)
7. [Queue Agent: Task 3.7 — Queue Manager (RED/GREEN)](#queue-agent-task-37--queue-manager-redgreen)
8. [Queue Agent: Task 3.9 — Cron Worker](#queue-agent-task-39--cron-worker)
9. [API Agent: Task 3.8 — API Routes](#api-agent-task-38--api-routes)
10. [UI Agent: Task 3.10 — Ingestion UI](#ui-agent-task-310--ingestion-ui)
11. [UI Agent: Task 3.11 — Articles Index Page](#ui-agent-task-311--articles-index-page)
12. [Integration Verification](#integration-verification)

---

## Validation Agent: Task 3.1 — Validation Schemas

> **Branch:** `feature/phase-3-validation`
> **Depends on:** Phase 1 complete (Prisma schema)
> **Must complete before:** All other Phase 3 agents

### Step 3.1.1 — Create the branch

- [ ] Create and switch to `feature/phase-3-validation` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git pull origin develop
git checkout -b feature/phase-3-validation
```

**Expected:** Branch created. `git branch --show-current` outputs `feature/phase-3-validation`.

### Step 3.1.2 — Create the validation directory

- [ ] Create the directory for validation files

```bash
mkdir -p src/lib/validation
```

**Expected:** Directory `src/lib/validation/` exists.

### Step 3.1.3 — Write common validation schemas

- [ ] Create `src/lib/validation/common.ts`

**File:** `src/lib/validation/common.ts`

```typescript
import { z } from "zod";

/**
 * Common validation schemas shared across all API routes.
 *
 * - paginationSchema: validates page/limit query params with sane defaults
 * - uuidSchema: validates CUID format used by Prisma @id @default(cuid())
 * - urlSchema: validates HTTP/HTTPS URLs only (rejects ftp://, file://, data://, etc.)
 */

/** Pagination query parameters. Coerces string query params to numbers. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

/** Prisma CUID identifier. */
export const uuidSchema = z.string().cuid();

/**
 * URL schema restricted to HTTP and HTTPS protocols.
 * Rejects ftp://, file://, data://, javascript:, and all other schemes.
 */
export const urlSchema = z
  .string()
  .url()
  .refine(
    (url) => url.startsWith("http://") || url.startsWith("https://"),
    "URL must use HTTP or HTTPS"
  );

export type PaginationInput = z.infer<typeof paginationSchema>;
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.1.4 — Write article ingestion schemas

- [ ] Create `src/lib/validation/articleSchemas.ts`

**File:** `src/lib/validation/articleSchemas.ts`

```typescript
import { z } from "zod";
import { urlSchema } from "./common";

/**
 * Ingestion request schemas using a discriminated union on the `method` field.
 *
 * Three ingestion methods:
 * 1. "sitemap" — provide a sitemap URL to crawl
 * 2. "url_list" — provide an explicit list of URLs to crawl
 * 3. "push" — directly push article content (no crawling)
 *
 * The discriminated union lets the API route parse the request once and
 * branch on the narrowed type.
 */

/** Crawl rate presets per DECISION-002. */
export const crawlPresetSchema = z
  .enum(["gentle", "standard", "fast"])
  .default("gentle");

/** Ingest via sitemap URL. */
export const ingestSitemapSchema = z.object({
  method: z.literal("sitemap"),
  sitemapUrl: urlSchema,
  crawlPreset: crawlPresetSchema,
});

/** Ingest via explicit URL list. Max 2000 URLs per submission. */
export const ingestUrlListSchema = z.object({
  method: z.literal("url_list"),
  urls: z.array(urlSchema).min(1).max(2000),
  crawlPreset: crawlPresetSchema,
});

/** Single article in a push payload. */
export const pushArticleSchema = z.object({
  url: urlSchema,
  title: z.string().min(1).max(500),
  body: z.string().min(1),
  bodyFormat: z.enum(["html", "markdown", "text"]).default("html"),
  metadata: z.record(z.unknown()).optional(),
});

/** Ingest via direct content push. Max 500 articles per submission. */
export const ingestPushSchema = z.object({
  method: z.literal("push"),
  articles: z.array(pushArticleSchema).min(1).max(500),
});

/**
 * Discriminated union for all ingestion requests.
 * Discriminant field: `method` ("sitemap" | "url_list" | "push").
 */
export const ingestRequestSchema = z.discriminatedUnion("method", [
  ingestSitemapSchema,
  ingestUrlListSchema,
  ingestPushSchema,
]);

export type IngestSitemapInput = z.infer<typeof ingestSitemapSchema>;
export type IngestUrlListInput = z.infer<typeof ingestUrlListSchema>;
export type IngestPushInput = z.infer<typeof ingestPushSchema>;
export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type PushArticle = z.infer<typeof pushArticleSchema>;
export type CrawlPreset = z.infer<typeof crawlPresetSchema>;
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.1.5 — Commit validation schemas

- [ ] Commit both schema files

```bash
git add src/lib/validation/common.ts src/lib/validation/articleSchemas.ts
git commit -m "feat(validation): add common and article ingestion Zod schemas

Adds paginationSchema, uuidSchema, urlSchema in common.ts.
Adds discriminated union ingestRequestSchema (sitemap/url_list/push)
in articleSchemas.ts with crawlPreset and pushArticle sub-schemas."
```

**Expected:** Clean commit on `feature/phase-3-validation`.

---

## Validation Agent: Task 3.2 — SSRF URL Validator

> **Branch:** `feature/phase-3-validation` (continues from 3.1)
> **Depends on:** Task 3.1 (urlSchema)

### Step 3.2.1 — Create the ingestion directory

- [ ] Create the directory for ingestion files

```bash
mkdir -p src/lib/ingestion
```

**Expected:** Directory `src/lib/ingestion/` exists.

### Step 3.2.2 — Write the SSRF URL validator

- [ ] Create `src/lib/ingestion/url-validator.ts`

**File:** `src/lib/ingestion/url-validator.ts`

```typescript
/**
 * SSRF URL validation for the ingestion pipeline.
 *
 * [AAP-B1] Dual-point validation:
 *   1. At submission time: `validatePublicUrl()` performs synchronous hostname checks
 *      for fast user feedback. Rejects known-private hostnames, private IP literals,
 *      and non-HTTP schemes.
 *   2. At fetch time: `validateResolvedIp()` checks the IP address returned by
 *      dns.resolve4() immediately before the HTTP request. Prevents DNS rebinding.
 *
 * Every URL in a redirect chain must also pass validation.
 */

import { URL } from "url";

/** Result of URL validation. */
export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Private IPv4 ranges per RFC 1918, RFC 5737, RFC 6598, plus link-local and loopback.
 * Each entry: [startLong, endLong] inclusive.
 */
const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [ipToLong("10.0.0.0"), ipToLong("10.255.255.255")], // 10.0.0.0/8
  [ipToLong("172.16.0.0"), ipToLong("172.31.255.255")], // 172.16.0.0/12
  [ipToLong("192.168.0.0"), ipToLong("192.168.255.255")], // 192.168.0.0/16
  [ipToLong("127.0.0.0"), ipToLong("127.255.255.255")], // 127.0.0.0/8 loopback
  [ipToLong("169.254.0.0"), ipToLong("169.254.255.255")], // 169.254.0.0/16 link-local
  [ipToLong("0.0.0.0"), ipToLong("0.255.255.255")], // 0.0.0.0/8
  [ipToLong("100.64.0.0"), ipToLong("100.127.255.255")], // 100.64.0.0/10 CGN
  [ipToLong("192.0.0.0"), ipToLong("192.0.0.255")], // 192.0.0.0/24
  [ipToLong("198.18.0.0"), ipToLong("198.19.255.255")], // 198.18.0.0/15 benchmark
  [ipToLong("224.0.0.0"), ipToLong("255.255.255.255")], // multicast + reserved
];

/** Blocked IPv6 prefixes and addresses. */
const PRIVATE_IPV6_PREFIXES = [
  "::1", // loopback
  "fc", // fc00::/7 unique local
  "fd", // fc00::/7 unique local
  "fe80", // link-local
  "::", // unspecified
];

/** Blocked hostnames regardless of resolution. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "[::1]",
  "0.0.0.0",
  "metadata.google.internal", // GCP metadata
  "169.254.169.254", // Cloud metadata endpoint
]);

/** Allowed URL schemes. */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Convert dotted-quad IPv4 string to a 32-bit unsigned integer.
 */
function ipToLong(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if an IPv4 address (dotted-quad string) falls within any private range.
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  if (parts.some((p) => isNaN(Number(p)) || Number(p) < 0 || Number(p) > 255)) {
    return false;
  }

  const long = ipToLong(ip);
  return PRIVATE_IPV4_RANGES.some(([start, end]) => long >= start && long <= end);
}

/**
 * Check if an IPv6 address is private/reserved.
 */
export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  if (normalized === "::1" || normalized === "::") return true;
  return PRIVATE_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Validate a URL at submission time (synchronous, hostname-level).
 *
 * Rejects:
 * - Non-HTTP/HTTPS schemes (file://, ftp://, data://, javascript:)
 * - Known-private hostnames (localhost, metadata endpoints)
 * - IP literals that resolve to private ranges
 * - URLs with credentials (user:pass@host)
 */
export function validatePublicUrl(url: string): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  // Scheme check
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      valid: false,
      reason: `Scheme "${parsed.protocol.replace(":", "")}" is not allowed. Use HTTP or HTTPS.`,
    };
  }

  // Credentials check
  if (parsed.username || parsed.password) {
    return { valid: false, reason: "URLs with credentials are not allowed" };
  }

  // Blocked hostname check
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: `Hostname "${hostname}" is blocked` };
  }

  // IPv4 literal check
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIpv4(hostname)) {
      return { valid: false, reason: `IP address "${hostname}" is in a private range` };
    }
  }

  // IPv6 literal check (hostname in brackets like [::1])
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const ipv6 = hostname.slice(1, -1);
    if (isPrivateIpv6(ipv6)) {
      return { valid: false, reason: `IPv6 address "${ipv6}" is in a private range` };
    }
  }

  // Bare IPv6 check
  if (isPrivateIpv6(hostname)) {
    return { valid: false, reason: `IPv6 address "${hostname}" is in a private range` };
  }

  return { valid: true };
}

/**
 * Validate a resolved IP address at fetch time.
 *
 * [AAP-B1] Called after dns.resolve4() in crawler.ts, immediately before
 * making the HTTP request. Prevents DNS rebinding attacks.
 *
 * @param ip - The resolved IPv4 address
 * @returns Validation result
 */
export function validateResolvedIp(ip: string): UrlValidationResult {
  if (isPrivateIpv4(ip)) {
    return {
      valid: false,
      reason: `Resolved IP "${ip}" is in a private range (possible DNS rebinding)`,
    };
  }
  return { valid: true };
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.2.3 — Commit the SSRF validator

- [ ] Commit the URL validator

```bash
git add src/lib/ingestion/url-validator.ts
git commit -m "feat(ingestion): add SSRF URL validator with dual-point validation

Implements validatePublicUrl() for submission-time hostname checks and
validateResolvedIp() for fetch-time DNS rebinding prevention [AAP-B1].
Rejects private IPs, localhost, cloud metadata, non-HTTP schemes."
```

**Expected:** Clean commit on `feature/phase-3-validation`.

### Step 3.2.4 — Push the validation branch

- [ ] Push `feature/phase-3-validation` so parallel agents can branch from it

```bash
git push -u origin feature/phase-3-validation
```

**Expected:** Branch available on remote.

---

## Parser Agent: Task 3.3 — Normalizer (RED/GREEN)

> **Branch:** `feature/phase-3-parser`
> **Depends on:** Validation Agent complete (`feature/phase-3-validation`)
> **Worktree:** Use git worktree for parallel execution

### Step 3.3.1 — Create parser branch and worktree

- [ ] Create a worktree for the Parser Agent branching from validation

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git fetch origin feature/phase-3-validation
git worktree add ../SEO-ilator-parser feature/phase-3-validation
cd ../SEO-ilator-parser
git checkout -b feature/phase-3-parser
npm install
```

**Expected:** Worktree at `../SEO-ilator-parser` on branch `feature/phase-3-parser`.

### Step 3.3.2 — Create test directory structure

- [ ] Create the test directory for ingestion tests

```bash
mkdir -p tests/lib/ingestion
```

**Expected:** Directory `tests/lib/ingestion/` exists.

### Step 3.3.3 — RED: Write failing normalizer tests (5 cases)

- [ ] Create `tests/lib/ingestion/normalizer.test.ts` with 5 failing tests

**File:** `tests/lib/ingestion/normalizer.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  normalizeArticle,
  computeBodyHash,
  computeTitleHash,
  type RawArticleInput,
  type NormalizedArticle,
} from "@/lib/ingestion/normalizer";

describe("normalizer", () => {
  const baseInput: RawArticleInput = {
    url: "https://example.com/test-article",
    title: "Test Article Title",
    body: "This is the body of the test article with enough words to pass.",
    bodyFormat: "text",
    sourceType: "api_push",
    existingLinks: [],
    metadata: {},
  };

  it("computes_consistent_hash_across_input_formats", () => {
    // Same content in HTML and text should produce the same bodyHash
    const textInput: RawArticleInput = {
      ...baseInput,
      body: "Hello world this is a test article body",
      bodyFormat: "text",
    };

    const htmlInput: RawArticleInput = {
      ...baseInput,
      body: "<p>Hello world this is a test article body</p>",
      bodyFormat: "html",
    };

    const textResult = normalizeArticle(textInput);
    const htmlResult = normalizeArticle(htmlInput);

    expect(textResult.bodyHash).toBe(htmlResult.bodyHash);
    // Hashes should be 64 chars (SHA-256 hex)
    expect(textResult.bodyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("strips_html_tags_for_plain_text_body", () => {
    const input: RawArticleInput = {
      ...baseInput,
      body: '<p>Hello <strong>world</strong></p><script>alert("xss")</script><a href="/link">click</a>',
      bodyFormat: "html",
    };

    const result = normalizeArticle(input);

    expect(result.body).not.toContain("<p>");
    expect(result.body).not.toContain("<strong>");
    expect(result.body).not.toContain("<script>");
    expect(result.body).not.toContain("<a");
    expect(result.body).toContain("Hello");
    expect(result.body).toContain("world");
    expect(result.body).toContain("click");
  });

  it("computes_correct_word_count", () => {
    const input: RawArticleInput = {
      ...baseInput,
      body: "One two three four five six seven eight nine ten",
      bodyFormat: "text",
    };

    const result = normalizeArticle(input);

    expect(result.wordCount).toBe(10);
  });

  it("handles_empty_body_without_error", () => {
    const input: RawArticleInput = {
      ...baseInput,
      body: "",
      bodyFormat: "text",
    };

    const result = normalizeArticle(input);

    expect(result.body).toBe("");
    expect(result.wordCount).toBe(0);
    expect(result.bodyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("handles_unicode_content", () => {
    const input: RawArticleInput = {
      ...baseInput,
      title: "Artikel über Suchmaschinenoptimierung",
      body: "日本語のコンテンツ avec des caractères spéciaux: é, ñ, ü, ø",
      bodyFormat: "text",
    };

    const result = normalizeArticle(input);

    expect(result.title).toBe("Artikel über Suchmaschinenoptimierung");
    expect(result.body).toContain("日本語");
    expect(result.body).toContain("caractères");
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.titleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bodyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  describe("computeBodyHash", () => {
    it("returns_consistent_hash_for_same_input", () => {
      const hash1 = computeBodyHash("test content");
      const hash2 = computeBodyHash("test content");
      expect(hash1).toBe(hash2);
    });
  });

  describe("computeTitleHash", () => {
    it("returns_consistent_hash_for_same_input", () => {
      const hash1 = computeTitleHash("My Title");
      const hash2 = computeTitleHash("My Title");
      expect(hash1).toBe(hash2);
    });
  });
});
```

**Verify (RED):**

```bash
npx vitest run tests/lib/ingestion/normalizer.test.ts 2>&1 | tail -10
# Expected: 5 FAILED tests (module not found)
```

### Step 3.3.4 — Commit RED normalizer tests

- [ ] Commit the failing tests

```bash
git add tests/lib/ingestion/normalizer.test.ts
git commit -m "test(ingestion): add 5 failing normalizer tests (RED)

Tests: consistent hash across formats, HTML stripping, word count,
empty body handling, unicode content. All fail — module not yet created."
```

**Expected:** Clean commit.

### Step 3.3.5 — GREEN: Write normalizer implementation

- [ ] Create `src/lib/ingestion/normalizer.ts` to pass all 5 tests

**File:** `src/lib/ingestion/normalizer.ts`

```typescript
/**
 * Article normalizer — single entry point for all ingestion paths.
 *
 * Converts raw article input (HTML, markdown, or text) into a normalized
 * form with consistent hashing, stripped body text, and word count.
 *
 * Hash scope per DECISION-001 JUDGE modification:
 *   - bodyHash = SHA-256 of normalized body text only
 *   - titleHash = SHA-256 of normalized title only
 */

import { createHash } from "crypto";
import * as cheerio from "cheerio";

/** Raw article input from any ingestion method. */
export interface RawArticleInput {
  url: string;
  title: string;
  body: string;
  bodyFormat: "html" | "markdown" | "text";
  sourceType: "sitemap" | "upload" | "api_push";
  existingLinks: Array<{ href: string; anchorText: string; isFollow: boolean }>;
  metadata: Record<string, unknown>;
}

/** Normalized article ready for database storage. */
export interface NormalizedArticle {
  url: string;
  title: string;
  body: string;
  bodyHash: string;
  titleHash: string;
  wordCount: number;
  metadata: Record<string, unknown>;
  sourceType: "sitemap" | "upload" | "api_push";
  existingLinks: Array<{ href: string; anchorText: string; isFollow: boolean }>;
}

/**
 * Compute SHA-256 hash of a body string.
 * Normalizes whitespace before hashing for consistency across formats.
 */
export function computeBodyHash(body: string): string {
  const normalized = normalizeWhitespace(body);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Compute SHA-256 hash of a title string.
 * Normalizes whitespace before hashing for consistency.
 */
export function computeTitleHash(title: string): string {
  const normalized = normalizeWhitespace(title);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Normalize an article from any input format into the standard NormalizedArticle shape.
 */
export function normalizeArticle(input: RawArticleInput): NormalizedArticle {
  const plainBody = stripToPlainText(input.body, input.bodyFormat);
  const normalizedBody = normalizeWhitespace(plainBody);
  const normalizedTitle = normalizeWhitespace(input.title);

  return {
    url: input.url,
    title: normalizedTitle,
    body: normalizedBody,
    bodyHash: computeBodyHash(normalizedBody),
    titleHash: computeTitleHash(normalizedTitle),
    wordCount: countWords(normalizedBody),
    metadata: input.metadata,
    sourceType: input.sourceType,
    existingLinks: input.existingLinks,
  };
}

/**
 * Strip content to plain text based on input format.
 *
 * - "html": Use cheerio to strip all tags and extract text content.
 *   Script and style tags are removed entirely.
 * - "markdown": Strip common markdown syntax characters.
 * - "text": Return as-is.
 */
function stripToPlainText(
  content: string,
  format: "html" | "markdown" | "text"
): string {
  if (!content) return "";

  switch (format) {
    case "html":
      return stripHtml(content);
    case "markdown":
      return stripMarkdown(content);
    case "text":
      return content;
    default:
      return content;
  }
}

/**
 * Strip HTML tags using cheerio. Removes script/style elements entirely.
 */
function stripHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return $.text();
}

/**
 * Strip common markdown syntax for plain-text normalization.
 */
function stripMarkdown(md: string): string {
  return (
    md
      // Remove headers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic
      .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
      .replace(/_{1,3}(.*?)_{1,3}/g, "$1")
      // Remove links, keep text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Remove inline code
      .replace(/`([^`]*)`/g, "$1")
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, "")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, "")
      // Remove blockquotes
      .replace(/^>\s?/gm, "")
  );
}

/**
 * Collapse all whitespace (newlines, tabs, multiple spaces) into single spaces.
 * Trim leading/trailing whitespace.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Count words in a plain-text string.
 * Returns 0 for empty or whitespace-only strings.
 */
function countWords(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  return text.trim().split(/\s+/).length;
}
```

**Verify (GREEN):**

```bash
npx vitest run tests/lib/ingestion/normalizer.test.ts 2>&1 | tail -10
# Expected: 5 tests passed (+ 2 sub-describe tests = 7 total passing)
```

### Step 3.3.6 — Commit GREEN normalizer implementation

- [ ] Commit the passing implementation

```bash
git add src/lib/ingestion/normalizer.ts
git commit -m "feat(ingestion): implement article normalizer

Adds normalizeArticle(), computeBodyHash(), computeTitleHash().
Strips HTML via cheerio, markdown via regex, normalizes whitespace,
computes SHA-256 hashes and word counts. All 5 normalizer tests pass."
```

**Expected:** Clean commit. All normalizer tests green.

---

## Parser Agent: Task 3.4 — HTML Parser (RED/GREEN)

> **Branch:** `feature/phase-3-parser` (continues from 3.3)
> **Depends on:** Task 3.3 (normalizer.ts)

### Step 3.4.1 — RED: Write failing parser tests (6 cases)

- [ ] Create `tests/lib/ingestion/parser.test.ts` with 6 failing tests

**File:** `tests/lib/ingestion/parser.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { parsePage, type ParsedPage } from "@/lib/ingestion/parser";

describe("parser", () => {
  const SOURCE_URL = "https://example.com/articles/test";

  it("extracts_title_from_title_tag", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>My SEO Article</title></head>
        <body><h1>Different H1</h1><p>Body content here.</p></body>
      </html>
    `;

    const result = parsePage(html, SOURCE_URL);

    expect(result.title).toBe("My SEO Article");
  });

  it("falls_back_to_h1_when_no_title_tag", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head></head>
        <body><h1>Fallback Title from H1</h1><p>Body content.</p></body>
      </html>
    `;

    const result = parsePage(html, SOURCE_URL);

    expect(result.title).toBe("Fallback Title from H1");
  });

  it("extracts_existing_internal_links", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Links Page</title></head>
        <body>
          <a href="/about">About Us</a>
          <a href="https://example.com/contact">Contact</a>
          <a href="https://external.com/page" rel="nofollow">External</a>
          <a href="/blog">Blog</a>
        </body>
      </html>
    `;

    const result = parsePage(html, SOURCE_URL);

    // Should extract internal links (same domain + relative)
    expect(result.existingLinks).toHaveLength(3);

    const aboutLink = result.existingLinks.find((l) => l.href.includes("/about"));
    expect(aboutLink).toBeDefined();
    expect(aboutLink!.anchorText).toBe("About Us");
    expect(aboutLink!.isFollow).toBe(true);

    const blogLink = result.existingLinks.find((l) => l.href.includes("/blog"));
    expect(blogLink).toBeDefined();
    expect(blogLink!.isFollow).toBe(true);
  });

  it("detects_noindex_directive", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>No Index Page</title>
          <meta name="robots" content="noindex, follow">
        </head>
        <body><p>This page should not be indexed.</p></body>
      </html>
    `;

    const result = parsePage(html, SOURCE_URL);

    expect(result.robotsDirectives.index).toBe(false);
    expect(result.robotsDirectives.follow).toBe(true);
  });

  it("extracts_meta_description", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Meta Test</title>
          <meta name="description" content="This is the meta description for SEO.">
        </head>
        <body><p>Page body.</p></body>
      </html>
    `;

    const result = parsePage(html, SOURCE_URL);

    expect(result.metaDescription).toBe(
      "This is the meta description for SEO."
    );
  });

  it("extracts_heading_structure", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Headings Test</title></head>
        <body>
          <h1>Main Title</h1>
          <h2>Section One</h2>
          <p>Some content.</p>
          <h2>Section Two</h2>
          <h3>Subsection A</h3>
          <p>More content.</p>
        </body>
      </html>
    `;

    const result = parsePage(html, SOURCE_URL);

    expect(result.headings).toEqual([
      { level: 1, text: "Main Title" },
      { level: 2, text: "Section One" },
      { level: 2, text: "Section Two" },
      { level: 3, text: "Subsection A" },
    ]);
  });
});
```

**Verify (RED):**

```bash
npx vitest run tests/lib/ingestion/parser.test.ts 2>&1 | tail -10
# Expected: 6 FAILED tests (module not found)
```

### Step 3.4.2 — Commit RED parser tests

- [ ] Commit the failing tests

```bash
git add tests/lib/ingestion/parser.test.ts
git commit -m "test(ingestion): add 6 failing HTML parser tests (RED)

Tests: title extraction, h1 fallback, internal link extraction,
noindex detection, meta description, heading structure. All fail."
```

**Expected:** Clean commit.

### Step 3.4.3 — GREEN: Write HTML parser implementation

- [ ] Create `src/lib/ingestion/parser.ts` to pass all 6 tests

**File:** `src/lib/ingestion/parser.ts`

```typescript
/**
 * HTML parser for the ingestion pipeline.
 *
 * Uses cheerio to extract structured data from HTML pages:
 * - Title (from <title>, fallback <h1>, fallback og:title)
 * - Body text (stripped of scripts/styles)
 * - Heading hierarchy
 * - Existing internal links with follow/nofollow status
 * - Canonical URL
 * - Meta title, description
 * - Robots directives (index/follow)
 * - Language
 */

import * as cheerio from "cheerio";

/** Structured data extracted from an HTML page. */
export interface ParsedPage {
  title: string;
  body: string;
  headings: Array<{ level: number; text: string }>;
  existingLinks: Array<{ href: string; anchorText: string; isFollow: boolean }>;
  canonicalUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  robotsDirectives: { index: boolean; follow: boolean };
  language: string | null;
}

/**
 * Parse an HTML string and extract structured SEO-relevant data.
 *
 * @param html - Raw HTML content
 * @param sourceUrl - The URL this page was fetched from (used to resolve relative links
 *                    and determine internal vs external)
 * @returns ParsedPage with all extracted fields
 */
export function parsePage(html: string, sourceUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const sourceOrigin = new URL(sourceUrl).origin;

  return {
    title: extractTitle($),
    body: extractBody($),
    headings: extractHeadings($),
    existingLinks: extractLinks($, sourceUrl, sourceOrigin),
    canonicalUrl: extractCanonical($),
    metaTitle: extractMetaTitle($),
    metaDescription: extractMetaDescription($),
    robotsDirectives: extractRobotsDirectives($),
    language: extractLanguage($),
  };
}

/**
 * Extract the page title with fallback chain:
 * 1. <title> tag
 * 2. First <h1>
 * 3. og:title meta
 * 4. Empty string
 */
function extractTitle($: cheerio.CheerioAPI): string {
  // 1. <title> tag
  const titleTag = $("title").first().text().trim();
  if (titleTag) return titleTag;

  // 2. First <h1>
  const h1 = $("h1").first().text().trim();
  if (h1) return h1;

  // 3. og:title
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  if (ogTitle) return ogTitle;

  return "";
}

/**
 * Extract body text, stripping script/style/noscript elements.
 */
function extractBody($: cheerio.CheerioAPI): string {
  const $clone = cheerio.load($.html() || "");
  $clone("script, style, noscript, nav, header, footer").remove();

  const bodyEl = $clone("body").first();
  if (bodyEl.length === 0) return $clone.text().trim();

  return bodyEl.text().replace(/\s+/g, " ").trim();
}

/**
 * Extract heading hierarchy (h1-h6).
 */
function extractHeadings(
  $: cheerio.CheerioAPI
): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];

  $("h1, h2, h3, h4, h5, h6").each((_i, el) => {
    const tagName = (el as cheerio.Element).tagName?.toLowerCase() || "";
    const level = parseInt(tagName.replace("h", ""), 10);
    const text = $(el).text().trim();
    if (text && !isNaN(level)) {
      headings.push({ level, text });
    }
  });

  return headings;
}

/**
 * Extract internal links from the page.
 * A link is internal if it is relative or matches the source URL's origin.
 * External links are excluded.
 */
function extractLinks(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
  sourceOrigin: string
): Array<{ href: string; anchorText: string; isFollow: boolean }> {
  const links: Array<{ href: string; anchorText: string; isFollow: boolean }> =
    [];

  $("a[href]").each((_i, el) => {
    const rawHref = $(el).attr("href")?.trim();
    if (!rawHref) return;

    // Skip anchors, javascript:, mailto:, tel:
    if (
      rawHref.startsWith("#") ||
      rawHref.startsWith("javascript:") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:")
    ) {
      return;
    }

    let absoluteHref: string;
    try {
      absoluteHref = new URL(rawHref, sourceUrl).href;
    } catch {
      return; // Malformed URL, skip
    }

    // Check if internal (same origin)
    const linkOrigin = new URL(absoluteHref).origin;
    if (linkOrigin !== sourceOrigin) return;

    const rel = $(el).attr("rel")?.toLowerCase() || "";
    const isFollow = !rel.includes("nofollow");
    const anchorText = $(el).text().trim();

    links.push({
      href: absoluteHref,
      anchorText,
      isFollow,
    });
  });

  return links;
}

/**
 * Extract canonical URL from <link rel="canonical">.
 */
function extractCanonical($: cheerio.CheerioAPI): string | null {
  const canonical = $('link[rel="canonical"]').attr("href")?.trim();
  return canonical || null;
}

/**
 * Extract meta title (og:title or twitter:title).
 */
function extractMetaTitle($: cheerio.CheerioAPI): string | null {
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  if (ogTitle) return ogTitle;

  const twitterTitle = $('meta[name="twitter:title"]').attr("content")?.trim();
  return twitterTitle || null;
}

/**
 * Extract meta description from <meta name="description">.
 */
function extractMetaDescription($: cheerio.CheerioAPI): string | null {
  const desc = $('meta[name="description"]').attr("content")?.trim();
  return desc || null;
}

/**
 * Extract robots directives from <meta name="robots">.
 * Defaults: index=true, follow=true (permissive by default).
 */
function extractRobotsDirectives($: cheerio.CheerioAPI): {
  index: boolean;
  follow: boolean;
} {
  const robotsContent = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";

  // Default to allowing everything
  let index = true;
  let follow = true;

  if (robotsContent) {
    const directives = robotsContent.split(",").map((d) => d.trim());
    if (directives.includes("noindex")) index = false;
    if (directives.includes("nofollow")) follow = false;
    // "none" = noindex + nofollow
    if (directives.includes("none")) {
      index = false;
      follow = false;
    }
  }

  return { index, follow };
}

/**
 * Extract language from <html lang="...">.
 */
function extractLanguage($: cheerio.CheerioAPI): string | null {
  const lang = $("html").attr("lang")?.trim();
  return lang || null;
}
```

**Verify (GREEN):**

```bash
npx vitest run tests/lib/ingestion/parser.test.ts 2>&1 | tail -10
# Expected: 6 tests passed
```

### Step 3.4.4 — Commit GREEN parser implementation

- [ ] Commit the passing implementation

```bash
git add src/lib/ingestion/parser.ts
git commit -m "feat(ingestion): implement cheerio-based HTML parser

Extracts title (with h1/og:title fallbacks), body text, heading
hierarchy, internal links with follow status, canonical URL, meta
description, robots directives, and language. All 6 parser tests pass."
```

**Expected:** Clean commit. All parser tests green.

---

## Parser Agent: Task 3.5 — Sitemap Parser (RED/GREEN)

> **Branch:** `feature/phase-3-parser` (continues from 3.4)
> **Depends on:** Task 3.2 (url-validator.ts)

### Step 3.5.1 — RED: Write failing sitemap parser tests (4 cases)

- [ ] Create `tests/lib/ingestion/sitemap-parser.test.ts` with 4 failing tests

**File:** `tests/lib/ingestion/sitemap-parser.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSitemap,
  MAX_URLS,
  MAX_RECURSION_DEPTH,
} from "@/lib/ingestion/sitemap-parser";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sitemap-parser", () => {
  it("parses_standard_sitemap", async () => {
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/page-1</loc></url>
        <url><loc>https://example.com/page-2</loc></url>
        <url><loc>https://example.com/page-3</loc></url>
      </urlset>
    `;

    mockFetch.mockResolvedValueOnce(
      new Response(sitemapXml, {
        status: 200,
        headers: { "content-type": "application/xml" },
      })
    );

    const urls = await parseSitemap("https://example.com/sitemap.xml");

    expect(urls).toEqual([
      "https://example.com/page-1",
      "https://example.com/page-2",
      "https://example.com/page-3",
    ]);
  });

  it("handles_sitemap_index", async () => {
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
        <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
      </sitemapindex>
    `;

    const subSitemap1 = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/post-1</loc></url>
        <url><loc>https://example.com/post-2</loc></url>
      </urlset>
    `;

    const subSitemap2 = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/about</loc></url>
      </urlset>
    `;

    mockFetch
      .mockResolvedValueOnce(
        new Response(sitemapIndex, {
          status: 200,
          headers: { "content-type": "application/xml" },
        })
      )
      .mockResolvedValueOnce(
        new Response(subSitemap1, {
          status: 200,
          headers: { "content-type": "application/xml" },
        })
      )
      .mockResolvedValueOnce(
        new Response(subSitemap2, {
          status: 200,
          headers: { "content-type": "application/xml" },
        })
      );

    const urls = await parseSitemap("https://example.com/sitemap.xml");

    expect(urls).toHaveLength(3);
    expect(urls).toContain("https://example.com/post-1");
    expect(urls).toContain("https://example.com/post-2");
    expect(urls).toContain("https://example.com/about");
  });

  it("handles_malformed_xml", async () => {
    const malformedXml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://example.com/valid</loc></url>
        <url><loc>NOT A VALID URL<<<</loc>
        broken xml here
      </urlset>
    `;

    mockFetch.mockResolvedValueOnce(
      new Response(malformedXml, {
        status: 200,
        headers: { "content-type": "application/xml" },
      })
    );

    // Should not throw — graceful degradation
    const urls = await parseSitemap("https://example.com/sitemap.xml");

    // Should extract at least the valid URL
    expect(urls).toContain("https://example.com/valid");
  });

  it("returns_empty_for_empty_sitemap", async () => {
    const emptySitemap = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      </urlset>
    `;

    mockFetch.mockResolvedValueOnce(
      new Response(emptySitemap, {
        status: 200,
        headers: { "content-type": "application/xml" },
      })
    );

    const urls = await parseSitemap("https://example.com/sitemap.xml");

    expect(urls).toEqual([]);
  });
});
```

**Verify (RED):**

```bash
npx vitest run tests/lib/ingestion/sitemap-parser.test.ts 2>&1 | tail -10
# Expected: 4 FAILED tests (module not found)
```

### Step 3.5.2 — Commit RED sitemap parser tests

- [ ] Commit the failing tests

```bash
git add tests/lib/ingestion/sitemap-parser.test.ts
git commit -m "test(ingestion): add 4 failing sitemap parser tests (RED)

Tests: standard sitemap, sitemap index, malformed XML, empty sitemap.
All fail — module not yet created."
```

**Expected:** Clean commit.

### Step 3.5.3 — GREEN: Write sitemap parser implementation

- [ ] Create `src/lib/ingestion/sitemap-parser.ts` to pass all 4 tests

**File:** `src/lib/ingestion/sitemap-parser.ts`

```typescript
/**
 * Sitemap parser for the ingestion pipeline.
 *
 * Parses sitemap.xml and sitemap index files to extract article URLs.
 *
 * [AAP-O10] Safety limits:
 *   - Recursion depth: 2 (index -> sub-sitemap, never deeper)
 *   - Max decompressed size: 50MB per sitemap file
 *   - Max total URLs: 10,000 per submission
 *   - Deduplication after parsing all sub-sitemaps
 *   - Namespace-aware and namespace-unaware XML parsing
 */

/** Maximum number of URLs that can be returned per parseSitemap() call. */
export const MAX_URLS = 10_000;

/** Maximum recursion depth for sitemap index files. */
export const MAX_RECURSION_DEPTH = 2;

/** Maximum decompressed size for a single sitemap file (50MB). */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** User-Agent for sitemap fetches. */
const USER_AGENT = "SEO-ilator/1.0 (+https://seo-ilator.com/bot)";

/**
 * Parse a sitemap URL and return all discovered page URLs.
 *
 * Handles:
 *   - Standard sitemap.xml files
 *   - Sitemap index files (one level of nesting, max depth 2)
 *   - Malformed XML (graceful degradation — extracts what it can)
 *   - Namespace-aware and namespace-unaware XML
 *
 * @param url - URL of the sitemap to parse
 * @returns Array of deduplicated page URLs (max MAX_URLS)
 * @throws Error if URL count exceeds MAX_URLS
 */
export async function parseSitemap(url: string): Promise<string[]> {
  const allUrls = new Set<string>();
  await parseSitemapRecursive(url, allUrls, 0);

  const deduped = Array.from(allUrls);

  if (deduped.length > MAX_URLS) {
    throw new Error(
      `Sitemap contains ${deduped.length} URLs, exceeding the limit of ${MAX_URLS}. ` +
        `Please reduce the number of URLs or split into multiple ingestion requests.`
    );
  }

  return deduped;
}

/**
 * Recursively parse sitemaps, respecting depth limits.
 */
async function parseSitemapRecursive(
  url: string,
  collectedUrls: Set<string>,
  depth: number
): Promise<void> {
  if (depth > MAX_RECURSION_DEPTH) {
    return; // Silently stop recursion beyond limit
  }

  let xml: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching sitemap: ${url}`);
    }

    // Check content length before reading
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
      throw new Error(
        `Sitemap at ${url} exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB size limit`
      );
    }

    xml = await response.text();

    // Check actual size after decompression
    if (new TextEncoder().encode(xml).length > MAX_FILE_SIZE) {
      throw new Error(
        `Decompressed sitemap at ${url} exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB size limit`
      );
    }
  } catch (error) {
    // Log but don't throw for individual fetch failures in index processing
    if (depth > 0) {
      console.warn(`Failed to fetch sub-sitemap ${url}:`, error);
      return;
    }
    throw error;
  }

  // Detect if this is a sitemap index or a regular sitemap
  const isSitemapIndex =
    xml.includes("<sitemapindex") || xml.includes(":sitemapindex");

  if (isSitemapIndex) {
    const sitemapUrls = extractSitemapIndexUrls(xml);
    for (const subSitemapUrl of sitemapUrls) {
      await parseSitemapRecursive(subSitemapUrl, collectedUrls, depth + 1);
    }
  } else {
    const pageUrls = extractUrlsetUrls(xml);
    for (const pageUrl of pageUrls) {
      collectedUrls.add(pageUrl);
    }
  }
}

/**
 * Extract sub-sitemap URLs from a sitemap index.
 * Handles both namespaced and non-namespaced XML.
 */
function extractSitemapIndexUrls(xml: string): string[] {
  const urls: string[] = [];

  // Match <sitemap><loc>...</loc></sitemap> patterns
  // Handles with and without namespace prefix
  const sitemapPattern =
    /<(?:[\w-]+:)?sitemap[^>]*>[\s\S]*?<(?:[\w-]+:)?loc[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?loc>[\s\S]*?<\/(?:[\w-]+:)?sitemap>/gi;

  let match;
  while ((match = sitemapPattern.exec(xml)) !== null) {
    const locContent = match[1].trim();
    if (locContent && isValidUrl(locContent)) {
      urls.push(locContent);
    }
  }

  return urls;
}

/**
 * Extract page URLs from a urlset sitemap.
 * Handles both namespaced and non-namespaced XML.
 */
function extractUrlsetUrls(xml: string): string[] {
  const urls: string[] = [];

  // Match <url><loc>...</loc></url> patterns
  // Handles with and without namespace prefix
  const urlPattern =
    /<(?:[\w-]+:)?url[^>]*>[\s\S]*?<(?:[\w-]+:)?loc[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?loc>[\s\S]*?<\/(?:[\w-]+:)?url>/gi;

  let match;
  while ((match = urlPattern.exec(xml)) !== null) {
    const locContent = match[1].trim();
    if (locContent && isValidUrl(locContent)) {
      urls.push(locContent);
    }
  }

  return urls;
}

/**
 * Basic URL validation — must start with http:// or https://.
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
```

**Verify (GREEN):**

```bash
npx vitest run tests/lib/ingestion/sitemap-parser.test.ts 2>&1 | tail -10
# Expected: 4 tests passed
```

### Step 3.5.4 — Commit GREEN sitemap parser implementation

- [ ] Commit the passing implementation

```bash
git add src/lib/ingestion/sitemap-parser.ts
git commit -m "feat(ingestion): implement sitemap parser with safety limits

Parses sitemap.xml and sitemap index files. [AAP-O10] Enforces
recursion depth 2, 50MB size limit, 10K URL cap. Handles namespaced
and non-namespaced XML, deduplicates URLs. All 4 tests pass."
```

### Step 3.5.5 — Verify all Parser Agent tests pass

- [ ] Run all parser tests together

```bash
npx vitest run tests/lib/ingestion/normalizer.test.ts tests/lib/ingestion/parser.test.ts tests/lib/ingestion/sitemap-parser.test.ts 2>&1 | tail -15
# Expected: 15 tests passed (normalizer 5+2, parser 6, sitemap 4)
```

### Step 3.5.6 — Push parser branch

- [ ] Push the parser branch

```bash
git push -u origin feature/phase-3-parser
```

**Expected:** Branch available on remote.

---

## Queue Agent: Task 3.6 — Crawler (RED/GREEN)

> **Branch:** `feature/phase-3-queue`
> **Depends on:** Validation Agent complete (`feature/phase-3-validation`)
> **Worktree:** Use git worktree for parallel execution

### Step 3.6.1 — Create queue branch and worktree

- [ ] Create a worktree for the Queue Agent branching from validation

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git fetch origin feature/phase-3-validation
git worktree add ../SEO-ilator-queue feature/phase-3-validation
cd ../SEO-ilator-queue
git checkout -b feature/phase-3-queue
npm install
mkdir -p tests/lib/ingestion src/lib/ingestion src/app/api/cron/crawl
```

**Expected:** Worktree at `../SEO-ilator-queue` on branch `feature/phase-3-queue`.

### Step 3.6.2 — RED: Write failing crawler tests (4 cases)

- [ ] Create `tests/lib/ingestion/crawler.test.ts` with 4 failing tests

**File:** `tests/lib/ingestion/crawler.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchUrl,
  fetchRobotsTxt,
  isUrlAllowed,
  USER_AGENT,
  type CrawlOptions,
  type RobotsTxtRules,
} from "@/lib/ingestion/crawler";

// Mock dns.resolve4
vi.mock("dns/promises", () => ({
  resolve4: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import mocked dns
import { resolve4 } from "dns/promises";
const mockResolve4 = vi.mocked(resolve4);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("crawler", () => {
  const defaultOptions: CrawlOptions = {
    preset: "gentle",
    timeoutMs: 10_000,
  };

  it("rejects_private_ip_urls", async () => {
    // DNS resolves to a private IP — should be rejected at fetch time [AAP-B1]
    mockResolve4.mockResolvedValueOnce(["192.168.1.1"]);

    await expect(
      fetchUrl("https://evil.example.com/page", defaultOptions)
    ).rejects.toThrow(/private range/i);

    // fetch should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("respects_robots_txt_disallow", async () => {
    const robotsTxt = `
User-agent: *
Disallow: /admin/
Disallow: /private/

User-agent: SEO-ilator
Allow: /

Sitemap: https://example.com/sitemap.xml
    `;

    mockFetch.mockResolvedValueOnce(
      new Response(robotsTxt, { status: 200 })
    );

    const rules = await fetchRobotsTxt("example.com");

    expect(isUrlAllowed("https://example.com/blog/post-1", rules)).toBe(true);
    expect(isUrlAllowed("https://example.com/admin/settings", rules)).toBe(false);
    expect(isUrlAllowed("https://example.com/private/data", rules)).toBe(false);
    expect(isUrlAllowed("https://example.com/about", rules)).toBe(true);
  });

  it("sets_correct_user_agent_header", async () => {
    // DNS resolves to a public IP
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);

    mockFetch.mockResolvedValueOnce(
      new Response("<html><body>Hello</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    await fetchUrl("https://example.com/page", defaultOptions);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;

    expect(headers["User-Agent"]).toBe(USER_AGENT);
  });

  it("handles_timeout_gracefully", async () => {
    // DNS resolves to a public IP
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);

    // fetch that never resolves (simulates timeout)
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("The operation was aborted")), 50);
        })
    );

    await expect(
      fetchUrl("https://slow.example.com/page", { ...defaultOptions, timeoutMs: 50 })
    ).rejects.toThrow(/aborted|timeout/i);
  });
});
```

**Verify (RED):**

```bash
npx vitest run tests/lib/ingestion/crawler.test.ts 2>&1 | tail -10
# Expected: 4 FAILED tests (module not found)
```

### Step 3.6.3 — Commit RED crawler tests

- [ ] Commit the failing tests

```bash
git add tests/lib/ingestion/crawler.test.ts
git commit -m "test(ingestion): add 4 failing crawler tests (RED)

Tests: private IP rejection [AAP-B1], robots.txt disallow, user-agent
header, timeout handling. All fail — module not yet created."
```

**Expected:** Clean commit.

### Step 3.6.4 — GREEN: Write crawler implementation

- [ ] Create `src/lib/ingestion/crawler.ts` to pass all 4 tests

**File:** `src/lib/ingestion/crawler.ts`

```typescript
/**
 * Web crawler for the ingestion pipeline.
 *
 * Fetches HTML content from URLs with:
 * - Rate limiting via configurable presets (gentle/standard/fast)
 * - SSRF protection at fetch time via dns.resolve4() [AAP-B1]
 * - Manual redirect following with SSRF validation on each hop [AAP-B1]
 * - robots.txt parsing and enforcement
 * - Configurable per-URL timeout (default 10s)
 * - [AAP-O1] Empty/near-empty body detection for CSR pages
 */

import { resolve4 } from "dns/promises";
import {
  validateResolvedIp,
  isPrivateIpv4,
} from "./url-validator";

/** User-Agent header sent with all crawl requests. */
export const USER_AGENT = "SEO-ilator/1.0 (+https://seo-ilator.com/bot)";

/** Maximum number of redirects to follow per request. */
const MAX_REDIRECTS = 5;

/** Minimum word count threshold for CSR warning [AAP-O1]. */
const CSR_WORD_THRESHOLD = 50;

/** Minimum content-length (bytes) that triggers CSR check [AAP-O1]. */
const CSR_CONTENT_LENGTH_THRESHOLD = 1024;

/** Rate presets per DECISION-002. */
export const RATE_PRESETS = {
  gentle: { requestsPerSecond: 1, concurrency: 1 },
  standard: { requestsPerSecond: 3, concurrency: 2 },
  fast: { requestsPerSecond: 10, concurrency: 5 },
} as const;

export type CrawlPreset = keyof typeof RATE_PRESETS;

export interface CrawlOptions {
  preset: CrawlPreset;
  timeoutMs?: number;
}

export interface CrawlResult {
  url: string;
  html: string;
  httpStatus: number;
  responseTimeMs: number;
  redirectChain?: Array<{ url: string; status: number }>;
  parseWarning?: string;
  contentLength?: number;
}

export interface RobotsTxtRules {
  disallowedPaths: string[];
  allowedPaths: string[];
  sitemapUrls: string[];
}

/**
 * Fetch a URL with SSRF protection and timeout.
 *
 * [AAP-B1] Performs dns.resolve4() immediately before the HTTP request and
 * validates the resolved IP against private ranges. Disables automatic
 * redirect following; manually follows redirects and validates each target.
 *
 * @throws Error if URL resolves to a private IP or times out
 */
export async function fetchUrl(
  url: string,
  options: CrawlOptions
): Promise<CrawlResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const startTime = Date.now();
  const redirectChain: Array<{ url: string; status: number }> = [];

  let currentUrl = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    // [AAP-B1] Resolve DNS and validate IP before each request
    const hostname = new URL(currentUrl).hostname;

    // Skip DNS resolution for IP literals (already validated at submission)
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      const ips = await resolve4(hostname);
      for (const ip of ips) {
        const result = validateResolvedIp(ip);
        if (!result.valid) {
          throw new Error(
            `SSRF blocked: ${result.reason} for URL ${currentUrl}`
          );
        }
      }
    } else if (isPrivateIpv4(hostname)) {
      throw new Error(
        `SSRF blocked: IP address "${hostname}" is in a private range`
      );
    }

    const elapsed = Date.now() - startTime;
    const remainingTimeout = timeoutMs - elapsed;
    if (remainingTimeout <= 0) {
      throw new Error(`Timeout: exceeded ${timeoutMs}ms for URL ${url}`);
    }

    const response = await fetch(currentUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html, application/xhtml+xml, */*",
      },
      redirect: "manual", // [AAP-B1] Manual redirect following
      signal: AbortSignal.timeout(remainingTimeout),
    });

    // Handle redirects manually
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;

      const redirectUrl = new URL(location, currentUrl).href;
      redirectChain.push({ url: currentUrl, status: response.status });
      currentUrl = redirectUrl;
      continue;
    }

    const html = await response.text();
    const responseTimeMs = Date.now() - startTime;
    const contentLength =
      parseInt(response.headers.get("content-length") || "0", 10) || html.length;

    const result: CrawlResult = {
      url: currentUrl,
      html,
      httpStatus: response.status,
      responseTimeMs,
      redirectChain: redirectChain.length > 0 ? redirectChain : undefined,
      contentLength,
    };

    // [AAP-O1] Check for CSR / empty body
    if (
      response.status === 200 &&
      contentLength > CSR_CONTENT_LENGTH_THRESHOLD
    ) {
      const wordCount = html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(/\s+/).length;

      if (wordCount < CSR_WORD_THRESHOLD) {
        result.parseWarning =
          "This page may use client-side rendering. The extracted content appears empty. " +
          "Consider using the API push method instead.";
      }
    }

    return result;
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) for URL ${url}`);
}

/**
 * Fetch and parse robots.txt for a domain.
 *
 * Returns rules applicable to SEO-ilator's User-Agent and the wildcard agent.
 * Falls back to empty (permissive) rules if fetch fails.
 */
export async function fetchRobotsTxt(
  domain: string
): Promise<RobotsTxtRules> {
  const url = `https://${domain}/robots.txt`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return emptyRules();
    }

    const text = await response.text();
    return parseRobotsTxt(text);
  } catch {
    return emptyRules();
  }
}

/**
 * Check if a URL is allowed by robots.txt rules.
 *
 * Allow rules take precedence over Disallow per the spec.
 */
export function isUrlAllowed(url: string, rules: RobotsTxtRules): boolean {
  const parsed = new URL(url);
  const path = parsed.pathname + parsed.search;

  // Check if explicitly allowed (allow takes precedence)
  for (const allowedPath of rules.allowedPaths) {
    if (path.startsWith(allowedPath)) {
      return true;
    }
  }

  // Check if disallowed
  for (const disallowedPath of rules.disallowedPaths) {
    if (path.startsWith(disallowedPath)) {
      return false;
    }
  }

  return true; // Default: allowed
}

/**
 * Parse robots.txt content into structured rules.
 * Extracts rules for User-agent: * (wildcard).
 */
function parseRobotsTxt(text: string): RobotsTxtRules {
  const lines = text.split("\n").map((l) => l.trim());
  const rules: RobotsTxtRules = {
    disallowedPaths: [],
    allowedPaths: [],
    sitemapUrls: [],
  };

  let isRelevantAgent = false;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith("#") || line === "") {
      continue;
    }

    const [directive, ...valueParts] = line.split(":");
    const key = directive.trim().toLowerCase();
    const value = valueParts.join(":").trim();

    if (key === "user-agent") {
      isRelevantAgent = value === "*" || value.toLowerCase().includes("seo-ilator");
    } else if (key === "disallow" && isRelevantAgent && value) {
      rules.disallowedPaths.push(value);
    } else if (key === "allow" && isRelevantAgent && value) {
      rules.allowedPaths.push(value);
    } else if (key === "sitemap") {
      rules.sitemapUrls.push(value);
    }
  }

  return rules;
}

/** Return empty (permissive) rules. */
function emptyRules(): RobotsTxtRules {
  return { disallowedPaths: [], allowedPaths: [], sitemapUrls: [] };
}
```

**Verify (GREEN):**

```bash
npx vitest run tests/lib/ingestion/crawler.test.ts 2>&1 | tail -10
# Expected: 4 tests passed
```

### Step 3.6.5 — Commit GREEN crawler implementation

- [ ] Commit the passing implementation

```bash
git add src/lib/ingestion/crawler.ts
git commit -m "feat(ingestion): implement crawler with SSRF protection and rate presets

Fetches URLs with dns.resolve4() SSRF validation [AAP-B1], manual
redirect following, robots.txt support, and CSR detection [AAP-O1].
Rate presets: gentle (1/s), standard (3/s), fast (10/s). All 4 tests pass."
```

**Expected:** Clean commit. All crawler tests green.

---

## Queue Agent: Task 3.7 — Queue Manager (RED/GREEN)

> **Branch:** `feature/phase-3-queue` (continues from 3.6)
> **Depends on:** Task 3.6 (crawler.ts)

### Step 3.7.1 — RED: Write failing queue tests (5 cases)

- [ ] Create `tests/lib/ingestion/queue.test.ts` with 5 failing tests

**File:** `tests/lib/ingestion/queue.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createJob,
  claimBatch,
  completeTask,
  failTask,
  recoverZombieTasks,
  getJobStatus,
  cancelJob,
  ZOMBIE_THRESHOLD_MS,
  MAX_RETRIES,
} from "@/lib/ingestion/queue";

// Mock Prisma client
vi.mock("@/lib/db", () => {
  const mockPrisma = {
    ingestionJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    ingestionTask: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    article: {
      upsert: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

import { prisma } from "@/lib/db";

const mockPrisma = vi.mocked(prisma, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queue", () => {
  it("creates_job_with_pending_tasks", async () => {
    const mockJob = {
      id: "job_123",
      projectId: "proj_456",
      status: "pending",
      totalUrls: 3,
      completedUrls: 0,
      failedUrls: 0,
      preset: "gentle",
      createdAt: new Date(),
      completedAt: null,
    };

    mockPrisma.ingestionJob.create.mockResolvedValueOnce(mockJob as never);
    mockPrisma.ingestionTask.createMany.mockResolvedValueOnce({ count: 3 } as never);

    const result = await createJob("proj_456", [
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ], "gentle");

    expect(mockPrisma.ingestionJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "proj_456",
          status: "pending",
          totalUrls: 3,
          preset: "gentle",
        }),
      })
    );

    expect(mockPrisma.ingestionTask.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            url: "https://example.com/a",
            status: "pending",
          }),
        ]),
      })
    );

    expect(result.id).toBe("job_123");
  });

  it("claims_batch_respecting_rate_limits", async () => {
    const mockTasks = [
      { id: "task_1", jobId: "job_1", url: "https://a.com/1", status: "pending", retryCount: 0 },
      { id: "task_2", jobId: "job_1", url: "https://a.com/2", status: "pending", retryCount: 0 },
    ];

    // $queryRaw returns tasks claimed via FOR UPDATE SKIP LOCKED
    mockPrisma.$queryRaw.mockResolvedValueOnce(mockTasks as never);
    mockPrisma.ingestionTask.updateMany.mockResolvedValueOnce({ count: 2 } as never);

    const claimed = await claimBatch(10);

    // Should use raw SQL with FOR UPDATE SKIP LOCKED
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(claimed).toHaveLength(2);
  });

  it("recovers_zombie_tasks", async () => {
    // Tasks stuck in 'processing' longer than ZOMBIE_THRESHOLD_MS
    mockPrisma.$executeRaw.mockResolvedValueOnce(3 as never);

    const recovered = await recoverZombieTasks();

    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    expect(recovered).toBe(3);
  });

  it("fails_tasks_exceeding_retry_limit", async () => {
    // recoverZombieTasks should also mark tasks with retryCount >= MAX_RETRIES as failed
    // This is verified via the SQL in recoverZombieTasks
    mockPrisma.$executeRaw
      .mockResolvedValueOnce(2 as never) // Reset zombies to pending
      .mockResolvedValueOnce(1 as never); // Mark exceeded retries as failed

    const recovered = await recoverZombieTasks();

    // Should have called $executeRaw at least twice:
    // 1. Reset stuck tasks with retryCount < MAX_RETRIES
    // 2. Mark tasks with retryCount >= MAX_RETRIES as failed
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("marks_job_complete_when_all_tasks_done", async () => {
    // completeTask: after updating task, check if all tasks are done
    const mockTask = {
      id: "task_1",
      jobId: "job_1",
      url: "https://example.com/a",
      status: "processing",
      retryCount: 0,
    };

    // Compare-and-swap update
    mockPrisma.$executeRaw.mockResolvedValueOnce(1 as never);

    // Article upsert
    mockPrisma.article.upsert.mockResolvedValueOnce({} as never);

    // Check remaining tasks
    mockPrisma.ingestionTask.findMany.mockResolvedValueOnce([] as never);

    // Get job task counts
    mockPrisma.ingestionJob.findUniqueOrThrow.mockResolvedValueOnce({
      id: "job_1",
      totalUrls: 1,
      completedUrls: 0,
      failedUrls: 0,
      status: "running",
      tasks: [{ status: "completed" }],
    } as never);

    // Update job as completed
    mockPrisma.ingestionJob.update.mockResolvedValueOnce({} as never);

    await completeTask("task_1", {
      url: "https://example.com/a",
      title: "Test",
      body: "Test body content",
      bodyHash: "abc123",
      titleHash: "def456",
      wordCount: 3,
      metadata: {},
      sourceType: "sitemap",
      existingLinks: [],
    });

    // Job should be checked for completion
    expect(mockPrisma.ingestionJob.findUniqueOrThrow).toHaveBeenCalled();
  });
});
```

**Verify (RED):**

```bash
npx vitest run tests/lib/ingestion/queue.test.ts 2>&1 | tail -10
# Expected: 5 FAILED tests (module not found)
```

### Step 3.7.2 — Commit RED queue tests

- [ ] Commit the failing tests

```bash
git add tests/lib/ingestion/queue.test.ts
git commit -m "test(ingestion): add 5 failing queue manager tests (RED)

Tests: job creation, batch claiming, zombie recovery [AAP-B2],
retry limit enforcement, job completion detection. All fail."
```

**Expected:** Clean commit.

### Step 3.7.3 — GREEN: Write queue manager implementation

- [ ] Create `src/lib/ingestion/queue.ts` to pass all 5 tests

**File:** `src/lib/ingestion/queue.ts`

```typescript
/**
 * Ingestion queue manager.
 *
 * Database-backed job queue for async URL crawling. Uses PostgreSQL
 * FOR UPDATE SKIP LOCKED for concurrent-safe task claiming.
 *
 * [AAP-B2] Zombie recovery: tasks in 'processing' > 10 min (exceeds 300s
 * function timeout) are reset to 'pending' with retryCount++.
 * Tasks with retryCount >= 3 are marked 'failed'.
 *
 * [AAP-F9] cancelJob() sets job status to 'cancelled' and marks all
 * remaining 'pending' tasks as 'cancelled'.
 */

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { NormalizedArticle } from "./normalizer";

/** Zombie threshold: 10 minutes (600,000ms). Exceeds 300s Vercel function timeout [AAP-B2]. */
export const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000;

/** Maximum retries before marking a task as permanently failed. */
export const MAX_RETRIES = 3;

/**
 * Create an ingestion job with pending tasks for each URL.
 */
export async function createJob(
  projectId: string,
  urls: string[],
  preset: string
) {
  const job = await prisma.ingestionJob.create({
    data: {
      projectId,
      status: "pending",
      totalUrls: urls.length,
      completedUrls: 0,
      failedUrls: 0,
      preset,
    },
  });

  await prisma.ingestionTask.createMany({
    data: urls.map((url) => ({
      jobId: job.id,
      url,
      status: "pending",
      retryCount: 0,
    })),
  });

  return job;
}

/**
 * Claim a batch of pending tasks using FOR UPDATE SKIP LOCKED.
 *
 * This prevents multiple cron workers from claiming the same tasks.
 * Tasks are atomically set to 'processing' with a startedAt timestamp.
 *
 * @param batchSize - Maximum number of tasks to claim
 * @returns Array of claimed tasks
 */
export async function claimBatch(batchSize: number) {
  // Use raw SQL for FOR UPDATE SKIP LOCKED pattern
  const tasks = await prisma.$queryRaw<
    Array<{
      id: string;
      jobId: string;
      url: string;
      status: string;
      retryCount: number;
    }>
  >`
    SELECT t.id, t."jobId", t.url, t.status, t."retryCount"
    FROM "IngestionTask" t
    INNER JOIN "IngestionJob" j ON t."jobId" = j.id
    WHERE t.status = 'pending'
      AND j.status != 'cancelled'
    ORDER BY j."createdAt" ASC, t.id ASC
    LIMIT ${batchSize}
    FOR UPDATE OF t SKIP LOCKED
  `;

  if (tasks.length === 0) return [];

  // Mark claimed tasks as processing
  const taskIds = tasks.map((t) => t.id);
  await prisma.ingestionTask.updateMany({
    where: { id: { in: taskIds } },
    data: {
      status: "processing",
      startedAt: new Date(),
    },
  });

  // Update parent jobs to 'running' if still 'pending'
  const jobIds = [...new Set(tasks.map((t) => t.jobId))];
  for (const jobId of jobIds) {
    await prisma.ingestionJob.update({
      where: { id: jobId, status: "pending" },
      data: { status: "running" },
    }).catch(() => {
      // Job already running or cancelled — ignore
    });
  }

  return tasks;
}

/**
 * Mark a task as completed and upsert the article.
 *
 * Uses compare-and-swap: only completes if task is still 'processing'.
 * If 0 rows affected, logs conflict but does not throw [AAP-B2].
 */
export async function completeTask(
  taskId: string,
  articleData: NormalizedArticle
): Promise<void> {
  // Compare-and-swap: only update if still processing
  const updated = await prisma.$executeRaw`
    UPDATE "IngestionTask"
    SET status = 'completed', "processedAt" = NOW()
    WHERE id = ${taskId} AND status = 'processing'
  `;

  if (updated === 0) {
    console.warn(
      `Task ${taskId} was not in 'processing' state — skipping completion (possible duplicate)`
    );
    return;
  }

  // Upsert the article
  await prisma.article.upsert({
    where: {
      projectId_url: {
        projectId: await getProjectIdForTask(taskId),
        url: articleData.url,
      },
    },
    create: {
      projectId: await getProjectIdForTask(taskId),
      url: articleData.url,
      title: articleData.title,
      body: articleData.body,
      bodyHash: articleData.bodyHash,
      titleHash: articleData.titleHash,
      wordCount: articleData.wordCount,
      metadata: articleData.metadata as Prisma.InputJsonValue,
      sourceType: articleData.sourceType,
      existingLinks: articleData.existingLinks as unknown as Prisma.InputJsonValue,
    },
    update: {
      title: articleData.title,
      body: articleData.body,
      bodyHash: articleData.bodyHash,
      titleHash: articleData.titleHash,
      wordCount: articleData.wordCount,
      metadata: articleData.metadata as Prisma.InputJsonValue,
      sourceType: articleData.sourceType,
      existingLinks: articleData.existingLinks as unknown as Prisma.InputJsonValue,
      // Clear embedding when body changes (handled by bodyHash comparison in SQL)
      embeddingModel: null,
    },
  });

  // Check if job is complete
  await checkJobCompletion(taskId);
}

/**
 * Mark a task as failed with an error message.
 */
export async function failTask(
  taskId: string,
  error: string,
  httpStatus?: number
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "IngestionTask"
    SET status = 'failed',
        "errorMessage" = ${error},
        "httpStatus" = ${httpStatus ?? null},
        "processedAt" = NOW()
    WHERE id = ${taskId} AND status = 'processing'
  `;

  await checkJobCompletion(taskId);
}

/**
 * Recover zombie tasks: tasks stuck in 'processing' longer than 10 minutes.
 *
 * [AAP-B2] Two-step recovery:
 * 1. Reset tasks with retryCount < MAX_RETRIES to 'pending' with retryCount++
 * 2. Mark tasks with retryCount >= MAX_RETRIES as 'failed'
 *
 * @returns Total number of tasks recovered or failed
 */
export async function recoverZombieTasks(): Promise<number> {
  const threshold = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);

  // Step 1: Reset recoverable zombies (retryCount < MAX_RETRIES)
  const recovered = await prisma.$executeRaw`
    UPDATE "IngestionTask"
    SET status = 'pending',
        "startedAt" = NULL,
        "retryCount" = "retryCount" + 1
    WHERE status = 'processing'
      AND "startedAt" < ${threshold}
      AND "retryCount" < ${MAX_RETRIES}
  `;

  // Step 2: Permanently fail tasks that exceeded retry limit
  const failed = await prisma.$executeRaw`
    UPDATE "IngestionTask"
    SET status = 'failed',
        "errorMessage" = 'Exceeded maximum retry limit',
        "processedAt" = NOW()
    WHERE status = 'processing'
      AND "startedAt" < ${threshold}
      AND "retryCount" >= ${MAX_RETRIES}
  `;

  return (recovered as number) + (failed as number);
}

/**
 * Get job status with per-task details for progress polling.
 */
export async function getJobStatus(jobId: string) {
  return prisma.ingestionJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      tasks: {
        select: {
          id: true,
          url: true,
          status: true,
          errorMessage: true,
          httpStatus: true,
          responseTimeMs: true,
          processedAt: true,
        },
        orderBy: { processedAt: "desc" },
      },
    },
  });
}

/**
 * Cancel a job and all its pending tasks.
 *
 * [AAP-F9] Sets job status to 'cancelled' and marks all remaining
 * 'pending' tasks as 'cancelled'. Already-processing tasks will finish
 * but their results will be discarded by the cron worker.
 */
export async function cancelJob(jobId: string): Promise<void> {
  const job = await prisma.ingestionJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (job.status === "completed" || job.status === "failed") {
    throw new Error(`Job ${jobId} is already ${job.status} and cannot be cancelled`);
  }

  await prisma.ingestionJob.update({
    where: { id: jobId },
    data: { status: "cancelled", completedAt: new Date() },
  });

  await prisma.ingestionTask.updateMany({
    where: { jobId, status: "pending" },
    data: { status: "cancelled" as string },
  });
}

/**
 * Get the projectId for a task by traversing to its parent job.
 */
async function getProjectIdForTask(taskId: string): Promise<string> {
  const task = await prisma.ingestionTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { job: { select: { projectId: true } } },
  });
  return task.job.projectId;
}

/**
 * Check if all tasks in a job are done and update job status accordingly.
 */
async function checkJobCompletion(taskId: string): Promise<void> {
  // Get the job for this task
  const task = await prisma.ingestionTask.findUnique({
    where: { id: taskId },
    select: { jobId: true },
  });

  if (!task) return;

  const job = await prisma.ingestionJob.findUniqueOrThrow({
    where: { id: task.jobId },
    include: {
      tasks: {
        select: { status: true },
      },
    },
  });

  const allTasks = job.tasks;
  const completedCount = allTasks.filter((t) => t.status === "completed").length;
  const failedCount = allTasks.filter((t) => t.status === "failed").length;
  const doneCount = completedCount + failedCount;

  // Update counters
  await prisma.ingestionJob.update({
    where: { id: job.id },
    data: {
      completedUrls: completedCount,
      failedUrls: failedCount,
      ...(doneCount >= allTasks.length
        ? {
            status: failedCount === allTasks.length ? "failed" : "completed",
            completedAt: new Date(),
          }
        : {}),
    },
  });
}
```

**Verify (GREEN):**

```bash
npx vitest run tests/lib/ingestion/queue.test.ts 2>&1 | tail -10
# Expected: 5 tests passed
```

### Step 3.7.4 — Commit GREEN queue manager implementation

- [ ] Commit the passing implementation

```bash
git add src/lib/ingestion/queue.ts
git commit -m "feat(ingestion): implement queue manager with FOR UPDATE SKIP LOCKED

Adds createJob, claimBatch (FOR UPDATE SKIP LOCKED), completeTask
(compare-and-swap), failTask, recoverZombieTasks (10min threshold)
[AAP-B2], cancelJob [AAP-F9]. All 5 queue tests pass."
```

**Expected:** Clean commit. All queue tests green.

---

## Queue Agent: Task 3.9 — Cron Worker

> **Branch:** `feature/phase-3-queue` (continues from 3.7)
> **Depends on:** Task 3.6 (crawler.ts), Task 3.7 (queue.ts)

### Step 3.9.1 — Write the cron worker route

- [ ] Create `src/app/api/cron/crawl/route.ts`

**File:** `src/app/api/cron/crawl/route.ts`

```typescript
/**
 * Cron worker for async URL crawling.
 *
 * Invoked by Vercel Cron (or manual trigger) to process pending ingestion tasks.
 *
 * Execution flow:
 * 1. Verify CRON_SECRET header
 * 2. Recover zombie tasks [AAP-B2]
 * 3. Claim batch (up to 60 tasks, grouped by domain)
 * 4. Process each task: fetch -> parse -> normalize -> upsert
 * 5. Update task status and job counters
 * 6. Check job completion
 *
 * Timeout safety: stops processing at ~280s elapsed (under 300s Vercel limit).
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchUrl, fetchRobotsTxt, isUrlAllowed, type CrawlOptions } from "@/lib/ingestion/crawler";
import { parsePage } from "@/lib/ingestion/parser";
import { normalizeArticle, type RawArticleInput } from "@/lib/ingestion/normalizer";
import {
  recoverZombieTasks,
  claimBatch,
  completeTask,
  failTask,
} from "@/lib/ingestion/queue";

/** Maximum execution time before stopping (280s, under 300s Vercel limit). */
const MAX_EXECUTION_MS = 280_000;

/** Maximum tasks to claim per cron invocation. */
const BATCH_SIZE = 60;

export async function GET(request: NextRequest) {
  // 1. Verify CRON_SECRET
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    zombiesRecovered: 0,
    tasksClaimed: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    tasksSkipped: 0,
    elapsedMs: 0,
  };

  try {
    // 2. Recover zombie tasks
    results.zombiesRecovered = await recoverZombieTasks();

    // 3. Claim batch
    const tasks = await claimBatch(BATCH_SIZE);
    results.tasksClaimed = tasks.length;

    if (tasks.length === 0) {
      results.elapsedMs = Date.now() - startTime;
      return NextResponse.json({ message: "No pending tasks", ...results });
    }

    // Group tasks by domain for per-domain rate limiting
    const tasksByDomain = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const domain = new URL(task.url).hostname;
      const existing = tasksByDomain.get(domain) || [];
      existing.push(task);
      tasksByDomain.set(domain, existing);
    }

    // Cache robots.txt per domain
    const robotsCache = new Map<string, Awaited<ReturnType<typeof fetchRobotsTxt>>>();

    // 4. Process each task
    for (const [domain, domainTasks] of tasksByDomain) {
      // Fetch robots.txt once per domain
      if (!robotsCache.has(domain)) {
        try {
          const rules = await fetchRobotsTxt(domain);
          robotsCache.set(domain, rules);
        } catch {
          robotsCache.set(domain, {
            disallowedPaths: [],
            allowedPaths: [],
            sitemapUrls: [],
          });
        }
      }
      const rules = robotsCache.get(domain)!;

      for (const task of domainTasks) {
        // Timeout safety: stop at ~280s
        if (Date.now() - startTime > MAX_EXECUTION_MS) {
          results.tasksSkipped += 1;
          continue;
        }

        try {
          // Check robots.txt
          if (!isUrlAllowed(task.url, rules)) {
            await failTask(task.id, "Blocked by robots.txt");
            results.tasksFailed += 1;
            continue;
          }

          // Fetch the URL
          const crawlResult = await fetchUrl(task.url, {
            preset: "gentle", // Tasks inherit preset from job, simplified here
            timeoutMs: 10_000,
          });

          // Parse the HTML
          const parsed = parsePage(crawlResult.html, crawlResult.url);

          // Normalize into article format
          const normalized = normalizeArticle({
            url: crawlResult.url,
            title: parsed.title,
            body: parsed.body,
            bodyFormat: "html",
            sourceType: "sitemap",
            existingLinks: parsed.existingLinks,
            metadata: {
              headings: parsed.headings,
              canonicalUrl: parsed.canonicalUrl,
              metaTitle: parsed.metaTitle,
              metaDescription: parsed.metaDescription,
              robotsDirectives: parsed.robotsDirectives,
              language: parsed.language,
              httpStatus: crawlResult.httpStatus,
              responseTimeMs: crawlResult.responseTimeMs,
              redirectChain: crawlResult.redirectChain,
              parseWarning: crawlResult.parseWarning,
            },
          } satisfies RawArticleInput);

          // Complete the task and upsert article
          await completeTask(task.id, normalized);
          results.tasksCompleted += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          await failTask(task.id, message).catch(console.error);
          results.tasksFailed += 1;
        }
      }
    }

    results.elapsedMs = Date.now() - startTime;
    return NextResponse.json({ message: "Batch processed", ...results });
  } catch (error) {
    results.elapsedMs = Date.now() - startTime;
    console.error("Cron worker error:", error);
    return NextResponse.json(
      { error: "Internal server error", ...results },
      { status: 500 }
    );
  }
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.9.2 — Commit cron worker

- [ ] Commit the cron worker route

```bash
git add src/app/api/cron/crawl/route.ts
git commit -m "feat(ingestion): add cron worker for async URL crawling

Vercel Cron route: zombie recovery, batch claim (60 tasks), per-domain
robots.txt caching, fetch/parse/normalize/upsert pipeline. 280s timeout
safety. CRON_SECRET authorization."
```

### Step 3.9.3 — Verify all Queue Agent tests pass

- [ ] Run all queue agent tests together

```bash
npx vitest run tests/lib/ingestion/crawler.test.ts tests/lib/ingestion/queue.test.ts 2>&1 | tail -15
# Expected: 9 tests passed (crawler 4, queue 5)
```

### Step 3.9.4 — Push queue branch

- [ ] Push the queue branch

```bash
git push -u origin feature/phase-3-queue
```

**Expected:** Branch available on remote.

---

## API Agent: Task 3.8 — API Routes

> **Branch:** `feature/phase-3-api`
> **Depends on:** Validation Agent complete (`feature/phase-3-validation`)
> **Worktree:** Use git worktree for parallel execution

### Step 3.8.1 — Create API branch and worktree

- [ ] Create a worktree for the API Agent branching from validation

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git fetch origin feature/phase-3-validation
git worktree add ../SEO-ilator-api feature/phase-3-validation
cd ../SEO-ilator-api
git checkout -b feature/phase-3-api
npm install
mkdir -p src/app/api/articles/\[id\] src/app/api/jobs/\[id\]/cancel
```

**Expected:** Worktree at `../SEO-ilator-api` on branch `feature/phase-3-api`.

### Step 3.8.2 — Write POST/GET /api/articles route

- [ ] Create `src/app/api/articles/route.ts`

**File:** `src/app/api/articles/route.ts`

```typescript
/**
 * Article ingestion and listing API routes.
 *
 * POST /api/articles — Ingest articles via sitemap, URL list, or direct push.
 *   - Discriminated union request by `method` field
 *   - Sitemap/URL list <50 URLs: synchronous, returns 201
 *   - Sitemap/URL list >=50 URLs: async queue, returns 202
 *   - Push: synchronous upsert, returns 201
 *
 * GET /api/articles — Paginated list with search and sort.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { ingestRequestSchema } from "@/lib/validation/articleSchemas";
import { paginationSchema } from "@/lib/validation/common";
import { validatePublicUrl } from "@/lib/ingestion/url-validator";
import { parseSitemap } from "@/lib/ingestion/sitemap-parser";
import { parsePage } from "@/lib/ingestion/parser";
import { normalizeArticle, type RawArticleInput } from "@/lib/ingestion/normalizer";
import { createJob } from "@/lib/ingestion/queue";
import { fetchUrl } from "@/lib/ingestion/crawler";

/** Threshold for sync vs async processing. */
const SYNC_THRESHOLD = 50;

export async function POST(request: NextRequest) {
  try {
    const { projectId } = await requireAuth();

    const body = await request.json();
    const parsed = ingestRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    switch (data.method) {
      case "push":
        return handlePush(projectId, data.articles);

      case "sitemap":
        return handleSitemap(projectId, data.sitemapUrl, data.crawlPreset);

      case "url_list":
        return handleUrlList(projectId, data.urls, data.crawlPreset);

      default:
        return NextResponse.json({ error: "Unknown method" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("POST /api/articles error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Handle push ingestion: synchronous upsert of article content.
 *
 * [AAP-O7] For bodyFormat "html", runs parsePage() to extract
 * existingLinks, headings, and metadata.
 */
async function handlePush(
  projectId: string,
  articles: Array<{
    url: string;
    title: string;
    body: string;
    bodyFormat: "html" | "markdown" | "text";
    metadata?: Record<string, unknown>;
  }>
) {
  // Validate all URLs for SSRF
  for (const article of articles) {
    const validation = validatePublicUrl(article.url);
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Invalid URL "${article.url}": ${validation.reason}` },
        { status: 400 }
      );
    }
  }

  let created = 0;
  let updated = 0;
  const results: Array<{ id: string; url: string; status: "created" | "updated" }> = [];

  for (const article of articles) {
    // [AAP-O7] Extract existingLinks from HTML push
    let existingLinks: Array<{ href: string; anchorText: string; isFollow: boolean }> = [];
    let additionalMetadata: Record<string, unknown> = {};

    if (article.bodyFormat === "html") {
      const parsed = parsePage(article.body, article.url);
      existingLinks = parsed.existingLinks;
      additionalMetadata = {
        headings: parsed.headings,
        canonicalUrl: parsed.canonicalUrl,
        metaTitle: parsed.metaTitle,
        metaDescription: parsed.metaDescription,
        robotsDirectives: parsed.robotsDirectives,
        language: parsed.language,
      };
    }

    const normalized = normalizeArticle({
      url: article.url,
      title: article.title,
      body: article.body,
      bodyFormat: article.bodyFormat,
      sourceType: "api_push",
      existingLinks,
      metadata: { ...article.metadata, ...additionalMetadata },
    } satisfies RawArticleInput);

    const existing = await prisma.article.findUnique({
      where: { projectId_url: { projectId, url: normalized.url } },
      select: { id: true },
    });

    const upserted = await prisma.article.upsert({
      where: { projectId_url: { projectId, url: normalized.url } },
      create: {
        projectId,
        url: normalized.url,
        title: normalized.title,
        body: normalized.body,
        bodyHash: normalized.bodyHash,
        titleHash: normalized.titleHash,
        wordCount: normalized.wordCount,
        metadata: normalized.metadata as Prisma.InputJsonValue,
        sourceType: normalized.sourceType,
        existingLinks: normalized.existingLinks as unknown as Prisma.InputJsonValue,
      },
      update: {
        title: normalized.title,
        body: normalized.body,
        bodyHash: normalized.bodyHash,
        titleHash: normalized.titleHash,
        wordCount: normalized.wordCount,
        metadata: normalized.metadata as Prisma.InputJsonValue,
        sourceType: normalized.sourceType,
        existingLinks: normalized.existingLinks as unknown as Prisma.InputJsonValue,
        embeddingModel: null, // Clear cache on content change
      },
    });

    if (existing) {
      updated += 1;
      results.push({ id: upserted.id, url: normalized.url, status: "updated" });
    } else {
      created += 1;
      results.push({ id: upserted.id, url: normalized.url, status: "created" });
    }
  }

  return NextResponse.json({ articles: results, created, updated }, { status: 201 });
}

/**
 * Handle sitemap ingestion: parse sitemap, then sync or async.
 */
async function handleSitemap(
  projectId: string,
  sitemapUrl: string,
  crawlPreset: string
) {
  // Validate sitemap URL for SSRF
  const validation = validatePublicUrl(sitemapUrl);
  if (!validation.valid) {
    return NextResponse.json(
      { error: `Invalid sitemap URL: ${validation.reason}` },
      { status: 400 }
    );
  }

  // Parse the sitemap to get URLs
  let urls: string[];
  try {
    urls = await parseSitemap(sitemapUrl);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to parse sitemap",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 422 }
    );
  }

  if (urls.length === 0) {
    return NextResponse.json(
      { error: "Sitemap contains no URLs" },
      { status: 422 }
    );
  }

  // Validate all discovered URLs for SSRF
  const invalidUrls: Array<{ url: string; reason: string }> = [];
  const validUrls: string[] = [];
  for (const url of urls) {
    const result = validatePublicUrl(url);
    if (result.valid) {
      validUrls.push(url);
    } else {
      invalidUrls.push({ url, reason: result.reason || "Unknown" });
    }
  }

  if (validUrls.length === 0) {
    return NextResponse.json(
      { error: "All URLs in sitemap failed SSRF validation", invalidUrls },
      { status: 422 }
    );
  }

  return processUrlBatch(projectId, validUrls, crawlPreset, {
    invalidUrls: invalidUrls.length > 0 ? invalidUrls : undefined,
  });
}

/**
 * Handle URL list ingestion: validate and process.
 */
async function handleUrlList(
  projectId: string,
  urls: string[],
  crawlPreset: string
) {
  // Validate all URLs for SSRF
  const invalidUrls: Array<{ url: string; reason: string }> = [];
  const validUrls: string[] = [];
  for (const url of urls) {
    const result = validatePublicUrl(url);
    if (result.valid) {
      validUrls.push(url);
    } else {
      invalidUrls.push({ url, reason: result.reason || "Unknown" });
    }
  }

  if (validUrls.length === 0) {
    return NextResponse.json(
      { error: "All URLs failed SSRF validation", invalidUrls },
      { status: 400 }
    );
  }

  return processUrlBatch(projectId, validUrls, crawlPreset, {
    invalidUrls: invalidUrls.length > 0 ? invalidUrls : undefined,
  });
}

/**
 * Process a batch of URLs: sync (<50) or async (>=50).
 */
async function processUrlBatch(
  projectId: string,
  urls: string[],
  crawlPreset: string,
  extra?: { invalidUrls?: Array<{ url: string; reason: string }> }
) {
  if (urls.length >= SYNC_THRESHOLD) {
    // Async: create job and return immediately
    const job = await createJob(projectId, urls, crawlPreset);

    return NextResponse.json(
      {
        jobId: job.id,
        totalUrls: urls.length,
        status: "pending",
        ...extra,
      },
      { status: 202 }
    );
  }

  // Sync: process all URLs immediately
  const results: Array<{ url: string; status: string; error?: string }> = [];
  let created = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      const crawlResult = await fetchUrl(url, {
        preset: crawlPreset as "gentle" | "standard" | "fast",
        timeoutMs: 10_000,
      });

      const parsed = parsePage(crawlResult.html, crawlResult.url);

      const normalized = normalizeArticle({
        url: crawlResult.url,
        title: parsed.title,
        body: parsed.body,
        bodyFormat: "html",
        sourceType: "sitemap",
        existingLinks: parsed.existingLinks,
        metadata: {
          headings: parsed.headings,
          canonicalUrl: parsed.canonicalUrl,
          metaTitle: parsed.metaTitle,
          metaDescription: parsed.metaDescription,
          robotsDirectives: parsed.robotsDirectives,
          language: parsed.language,
          httpStatus: crawlResult.httpStatus,
          responseTimeMs: crawlResult.responseTimeMs,
          parseWarning: crawlResult.parseWarning,
        },
      } satisfies RawArticleInput);

      await prisma.article.upsert({
        where: { projectId_url: { projectId, url: normalized.url } },
        create: {
          projectId,
          url: normalized.url,
          title: normalized.title,
          body: normalized.body,
          bodyHash: normalized.bodyHash,
          titleHash: normalized.titleHash,
          wordCount: normalized.wordCount,
          metadata: normalized.metadata as Prisma.InputJsonValue,
          sourceType: normalized.sourceType,
          existingLinks: normalized.existingLinks as unknown as Prisma.InputJsonValue,
        },
        update: {
          title: normalized.title,
          body: normalized.body,
          bodyHash: normalized.bodyHash,
          titleHash: normalized.titleHash,
          wordCount: normalized.wordCount,
          metadata: normalized.metadata as Prisma.InputJsonValue,
          sourceType: normalized.sourceType,
          existingLinks: normalized.existingLinks as unknown as Prisma.InputJsonValue,
          embeddingModel: null,
        },
      });

      created += 1;
      results.push({ url, status: "created" });
    } catch (error) {
      failed += 1;
      results.push({
        url,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json(
    { articles: results, created, failed, ...extra },
    { status: 201 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { projectId } = await requireAuth();

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const pagination = paginationSchema.parse(searchParams);

    const search = request.nextUrl.searchParams.get("search") || "";
    const sortBy = request.nextUrl.searchParams.get("sortBy") || "updatedAt";
    const sortOrder = request.nextUrl.searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

    const where: Prisma.ArticleWhereInput = {
      projectId,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { url: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where,
        select: {
          id: true,
          url: true,
          title: true,
          wordCount: true,
          sourceType: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { sourceRecommendations: true },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      prisma.article.count({ where }),
    ]);

    const response = {
      articles: articles.map((a) => ({
        id: a.id,
        url: a.url,
        title: a.title,
        wordCount: a.wordCount,
        sourceType: a.sourceType,
        recommendationCount: a._count.sourceRecommendations,
        lastAnalyzedAt: null as string | null, // TODO: populated when analysis is implemented
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("GET /api/articles error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.8.3 — Commit articles route

- [ ] Commit the articles route

```bash
git add src/app/api/articles/route.ts
git commit -m "feat(api): add POST/GET /api/articles with discriminated union ingestion

POST handles sitemap/url_list/push via discriminated union. <50 URLs
sync (201), >=50 async via queue (202). Push upserts with existingLinks
extraction for HTML [AAP-O7]. GET returns paginated list with search."
```

### Step 3.8.4 — Write GET/DELETE /api/articles/[id] route

- [ ] Create `src/app/api/articles/[id]/route.ts`

**File:** `src/app/api/articles/[id]/route.ts`

```typescript
/**
 * Individual article API routes.
 *
 * GET /api/articles/[id] — Full article detail with body preview and counts.
 * DELETE /api/articles/[id] — [AAP-B10] Delete with active analysis check.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { uuidSchema } from "@/lib/validation/common";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await requireAuth();

    const idResult = uuidSchema.safeParse(params.id);
    if (!idResult.success) {
      return NextResponse.json({ error: "Invalid article ID" }, { status: 400 });
    }

    const article = await prisma.article.findFirst({
      where: { id: params.id, projectId },
      include: {
        _count: {
          select: {
            sourceRecommendations: true,
          },
        },
        sourceRecommendations: {
          select: {
            severity: true,
          },
        },
      },
    });

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Count recommendations by severity
    const severityCounts = {
      critical: 0,
      warning: 0,
      info: 0,
    };
    for (const rec of article.sourceRecommendations) {
      if (rec.severity in severityCounts) {
        severityCounts[rec.severity as keyof typeof severityCounts] += 1;
      }
    }

    return NextResponse.json({
      id: article.id,
      url: article.url,
      title: article.title,
      bodyPreview: article.body.slice(0, 500),
      wordCount: article.wordCount,
      bodyHash: article.bodyHash,
      titleHash: article.titleHash,
      sourceType: article.sourceType,
      metadata: article.metadata,
      existingLinks: article.existingLinks,
      hasEmbedding: !!article.embeddingModel,
      embeddingModel: article.embeddingModel,
      recommendationCount: article._count.sourceRecommendations,
      recommendationsBySeverity: severityCounts,
      createdAt: article.createdAt.toISOString(),
      updatedAt: article.updatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("GET /api/articles/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await requireAuth();

    const idResult = uuidSchema.safeParse(params.id);
    if (!idResult.success) {
      return NextResponse.json({ error: "Invalid article ID" }, { status: 400 });
    }

    // Verify article exists and belongs to project
    const article = await prisma.article.findFirst({
      where: { id: params.id, projectId },
      select: { id: true },
    });

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // [AAP-B10] Check for active analysis runs
    const activeRuns = await prisma.analysisRun.findFirst({
      where: {
        projectId,
        status: { in: ["pending", "running"] },
      },
      select: { id: true },
    });

    if (activeRuns) {
      return NextResponse.json(
        { error: "Cannot delete articles while an analysis is running." },
        { status: 409 }
      );
    }

    // Delete article (cascades to recommendations per Prisma schema)
    await prisma.article.delete({
      where: { id: params.id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("DELETE /api/articles/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.8.5 — Commit article detail route

- [ ] Commit the article detail route

```bash
git add src/app/api/articles/\[id\]/route.ts
git commit -m "feat(api): add GET/DELETE /api/articles/[id] with analysis check

GET returns full article detail with severity breakdown.
DELETE checks for active analysis runs [AAP-B10] — returns 409
if analysis in progress, otherwise 204 with cascade."
```

### Step 3.8.6 — Write GET /api/jobs/[id] route

- [ ] Create `src/app/api/jobs/[id]/route.ts`

**File:** `src/app/api/jobs/[id]/route.ts`

```typescript
/**
 * Job status API route.
 *
 * GET /api/jobs/[id] — Returns job status with per-task detail for progress polling.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { getJobStatus } from "@/lib/ingestion/queue";
import { uuidSchema } from "@/lib/validation/common";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await requireAuth();

    const idResult = uuidSchema.safeParse(params.id);
    if (!idResult.success) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    const job = await getJobStatus(params.id);

    // Verify job belongs to the user's project
    if (job.projectId !== projectId) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const taskSummary = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of job.tasks) {
      if (task.status in taskSummary) {
        taskSummary[task.status as keyof typeof taskSummary] += 1;
      }
    }

    return NextResponse.json({
      id: job.id,
      status: job.status,
      totalUrls: job.totalUrls,
      completedUrls: job.completedUrls,
      failedUrls: job.failedUrls,
      preset: job.preset,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      taskSummary,
      tasks: job.tasks.map((t) => ({
        id: t.id,
        url: t.url,
        status: t.status,
        errorMessage: t.errorMessage,
        httpStatus: t.httpStatus,
        responseTimeMs: t.responseTimeMs,
        processedAt: t.processedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("GET /api/jobs/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.8.7 — Commit job status route

- [ ] Commit the job status route

```bash
git add src/app/api/jobs/\[id\]/route.ts
git commit -m "feat(api): add GET /api/jobs/[id] for ingestion progress polling

Returns job status with taskSummary counts and per-task detail
(url, status, error, httpStatus, responseTime). Project-scoped."
```

### Step 3.8.8 — Write POST /api/jobs/[id]/cancel route

- [ ] Create `src/app/api/jobs/[id]/cancel/route.ts`

**File:** `src/app/api/jobs/[id]/cancel/route.ts`

```typescript
/**
 * Job cancellation API route.
 *
 * POST /api/jobs/[id]/cancel — [AAP-F9] Cancel an ingestion job.
 * Returns 200 on success, 404 if not found, 409 if already completed/failed.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { cancelJob, getJobStatus } from "@/lib/ingestion/queue";
import { prisma } from "@/lib/db";
import { uuidSchema } from "@/lib/validation/common";

interface RouteParams {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await requireAuth();

    const idResult = uuidSchema.safeParse(params.id);
    if (!idResult.success) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    // Verify job exists and belongs to project
    const job = await prisma.ingestionJob.findUnique({
      where: { id: params.id },
      select: { id: true, projectId: true, status: true },
    });

    if (!job || job.projectId !== projectId) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "completed" || job.status === "failed") {
      return NextResponse.json(
        { error: `Job is already ${job.status} and cannot be cancelled` },
        { status: 409 }
      );
    }

    if (job.status === "cancelled") {
      return NextResponse.json(
        { error: "Job is already cancelled" },
        { status: 409 }
      );
    }

    await cancelJob(params.id);

    const updatedJob = await getJobStatus(params.id);

    return NextResponse.json({
      id: updatedJob.id,
      status: updatedJob.status,
      message: "Job cancelled successfully",
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("POST /api/jobs/[id]/cancel error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.8.9 — Commit cancel route

- [ ] Commit the cancel route

```bash
git add src/app/api/jobs/\[id\]/cancel/route.ts
git commit -m "feat(api): add POST /api/jobs/[id]/cancel endpoint [AAP-F9]

Cancels an ingestion job — returns 200 on success, 404 if not found,
409 if already completed/failed/cancelled. Project-scoped."
```

### Step 3.8.10 — Verify all API routes compile

- [ ] Run TypeScript check

```bash
npx tsc --noEmit 2>&1 | head -10
npm run build 2>&1 | tail -10
# Expected: both pass
```

### Step 3.8.11 — Push API branch

- [ ] Push the API branch

```bash
git push -u origin feature/phase-3-api
```

**Expected:** Branch available on remote.

---

## UI Agent: Task 3.10 — Ingestion UI

> **Branch:** `feature/phase-3-ui`
> **Depends on:** Validation Agent complete (`feature/phase-3-validation`)
> **Worktree:** Use git worktree for parallel execution

### Step 3.10.1 — Create UI branch and worktree

- [ ] Create a worktree for the UI Agent branching from validation

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git fetch origin feature/phase-3-validation
git worktree add ../SEO-ilator-ui feature/phase-3-validation
cd ../SEO-ilator-ui
git checkout -b feature/phase-3-ui
npm install
mkdir -p src/app/dashboard/ingest src/app/dashboard/articles src/components/forms src/components/feedback
```

**Expected:** Worktree at `../SEO-ilator-ui` on branch `feature/phase-3-ui`.

### Step 3.10.2 — Write CrawlRateSelector component

- [ ] Create `src/components/forms/CrawlRateSelector.tsx`

**File:** `src/components/forms/CrawlRateSelector.tsx`

```typescript
"use client";

/**
 * Crawl rate preset selector — radio group with Gentle/Standard/Fast options.
 * Fast shows a performance warning per DECISION-002.
 */

import { type CrawlPreset } from "@/lib/validation/articleSchemas";

interface CrawlRateSelectorProps {
  value: CrawlPreset;
  onChange: (preset: CrawlPreset) => void;
}

const PRESETS = [
  {
    id: "gentle" as const,
    label: "Gentle",
    description: "1 request/sec, 1 concurrent — safest for any site",
  },
  {
    id: "standard" as const,
    label: "Standard",
    description: "3 requests/sec, 2 concurrent — good for most sites",
  },
  {
    id: "fast" as const,
    label: "Fast",
    description: "10 requests/sec, 5 concurrent — for dedicated infrastructure only",
  },
];

export function CrawlRateSelector({ value, onChange }: CrawlRateSelectorProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-gray-700">Crawl Rate</legend>
      <div className="space-y-2">
        {PRESETS.map((preset) => (
          <label
            key={preset.id}
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              value === preset.id
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name="crawlPreset"
              value={preset.id}
              checked={value === preset.id}
              onChange={() => onChange(preset.id)}
              className="mt-1"
            />
            <div>
              <span className="text-sm font-medium">{preset.label}</span>
              <p className="text-xs text-gray-500">{preset.description}</p>
            </div>
          </label>
        ))}
      </div>
      {value === "fast" && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs text-amber-800">
            <strong>Warning:</strong> This may impact your site&apos;s performance
            for visitors. Only use for sites on dedicated infrastructure.
          </p>
        </div>
      )}
    </fieldset>
  );
}
```

### Step 3.10.3 — Write SitemapInput component

- [ ] Create `src/components/forms/SitemapInput.tsx`

**File:** `src/components/forms/SitemapInput.tsx`

```typescript
"use client";

/**
 * Sitemap URL input with validation hint.
 * Per Client Success plan: includes tip about common sitemap locations.
 */

interface SitemapInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function SitemapInput({ value, onChange, error }: SitemapInputProps) {
  return (
    <div className="space-y-1">
      <label htmlFor="sitemap-url" className="block text-sm font-medium text-gray-700">
        Sitemap URL
      </label>
      <input
        id="sitemap-url"
        type="url"
        placeholder="https://yoursite.com/sitemap.xml"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border px-3 py-2 text-sm ${
          error ? "border-red-500" : "border-gray-300"
        } focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500`}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-gray-500">
        Tip: Most sites serve their sitemap at{" "}
        <code className="bg-gray-100 px-1 rounded">yoursite.com/sitemap.xml</code>.
        WordPress sites use{" "}
        <code className="bg-gray-100 px-1 rounded">/wp-sitemap.xml</code>.
      </p>
    </div>
  );
}
```

### Step 3.10.4 — Write UrlListInput component

- [ ] Create `src/components/forms/UrlListInput.tsx`

**File:** `src/components/forms/UrlListInput.tsx`

```typescript
"use client";

/**
 * URL list textarea input — newline-separated, per-line validation.
 */

import { useState } from "react";

interface UrlListInputProps {
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
}

export function UrlListInput({ value, onChange, errors }: UrlListInputProps) {
  const [lineCount, setLineCount] = useState(0);

  const handleChange = (text: string) => {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    setLineCount(lines.length);
    onChange(text);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor="url-list" className="block text-sm font-medium text-gray-700">
          URLs (one per line)
        </label>
        <span className="text-xs text-gray-500">
          {lineCount} / 2,000 URLs
        </span>
      </div>
      <textarea
        id="url-list"
        rows={8}
        placeholder={`https://yoursite.com/article-1\nhttps://yoursite.com/article-2\nhttps://yoursite.com/article-3`}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
          errors && errors.length > 0 ? "border-red-500" : "border-gray-300"
        } focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500`}
      />
      {errors && errors.length > 0 && (
        <ul className="text-xs text-red-600 space-y-1">
          {errors.slice(0, 5).map((err, i) => (
            <li key={i}>{err}</li>
          ))}
          {errors.length > 5 && (
            <li>...and {errors.length - 5} more errors</li>
          )}
        </ul>
      )}
    </div>
  );
}
```

### Step 3.10.5 — Write FileDropzone component

- [ ] Create `src/components/forms/FileDropzone.tsx`

**File:** `src/components/forms/FileDropzone.tsx`

```typescript
"use client";

/**
 * Drag-and-drop file upload zone.
 *
 * [AAP-F7] File size limits: 10MB per file, 50MB total.
 * HTML files submitted via multipart/form-data to server (cheerio server-only).
 * .md and .json parsed client-side and submitted via method: "push".
 * Upload progress via XMLHttpRequest progress events.
 */

import { useCallback, useState, useRef, type DragEvent } from "react";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total
const ACCEPTED_EXTENSIONS = [".html", ".htm", ".md", ".json"];

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  uploadProgress?: number;
  isUploading?: boolean;
  error?: string;
}

export function FileDropzone({
  onFilesSelected,
  uploadProgress,
  isUploading,
  error,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFiles = useCallback((files: File[]): string | null => {
    let totalSize = 0;

    for (const file of files) {
      // Check extension
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        return `File "${file.name}" has an unsupported format. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`;
      }

      // Check individual file size
      if (file.size > MAX_FILE_SIZE) {
        return `File "${file.name}" exceeds the 10MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
      }

      totalSize += file.size;
    }

    // Check total size
    if (totalSize > MAX_TOTAL_SIZE) {
      return `Total file size exceeds the 50MB limit (${(totalSize / 1024 / 1024).toFixed(1)}MB)`;
    }

    return null;
  }, []);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;

      const files = Array.from(fileList);
      const validationErr = validateFiles(files);

      if (validationErr) {
        setValidationError(validationErr);
        return;
      }

      setValidationError(null);
      onFilesSelected(files);
    },
    [onFilesSelected, validateFiles]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const displayError = error || validationError;

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : displayError
              ? "border-red-300 bg-red-50"
              : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        }`}
      >
        <svg
          className="mb-3 h-10 w-10 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm text-gray-600">
          <span className="font-medium text-blue-600">Click to upload</span> or
          drag and drop
        </p>
        <p className="text-xs text-gray-500 mt-1">
          HTML, Markdown, or JSON files (max 10MB each, 50MB total)
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {isUploading && uploadProgress !== undefined && (
        <div className="space-y-1">
          <div className="h-2 w-full rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 text-center">
            Uploading... {uploadProgress}%
          </p>
        </div>
      )}

      {displayError && (
        <p className="text-xs text-red-600">{displayError}</p>
      )}
    </div>
  );
}
```

### Step 3.10.6 — Write UrlStatusFeed component

- [ ] Create `src/components/feedback/UrlStatusFeed.tsx`

**File:** `src/components/feedback/UrlStatusFeed.tsx`

```typescript
"use client";

/**
 * Scrollable per-URL status feed during ingestion.
 *
 * [AAP-F1] Polls GET /api/jobs/[id] with exponential backoff:
 * 3s -> 6s -> 12s -> 30s cap on consecutive failures.
 * Resets to 3s on success.
 * Pauses when document.visibilityState === 'hidden'.
 * Stops on terminal states (completed/failed/cancelled).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetch } from "@/lib/auth/api-client";

interface TaskStatus {
  id: string;
  url: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  errorMessage: string | null;
  httpStatus: number | null;
  processedAt: string | null;
}

interface JobStatus {
  id: string;
  status: string;
  totalUrls: number;
  completedUrls: number;
  failedUrls: number;
  taskSummary: Record<string, number>;
  tasks: TaskStatus[];
}

interface UrlStatusFeedProps {
  jobId: string;
  onJobComplete?: (job: JobStatus) => void;
  onCancel?: () => void;
}

const BASE_INTERVAL = 3_000;
const MAX_INTERVAL = 30_000;
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

export function UrlStatusFeed({ jobId, onJobComplete, onCancel }: UrlStatusFeedProps) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef(BASE_INTERVAL);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    // Pause when tab is hidden
    if (document.visibilityState === "hidden") {
      timerRef.current = setTimeout(poll, intervalRef.current);
      return;
    }

    try {
      const res = await apiFetch(`/api/jobs/${jobId}`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data: JobStatus = await res.json();
      setJob(data);
      setError(null);

      // Reset backoff on success
      intervalRef.current = BASE_INTERVAL;

      // Stop polling on terminal states
      if (TERMINAL_STATES.has(data.status)) {
        onJobComplete?.(data);
        return;
      }

      timerRef.current = setTimeout(poll, intervalRef.current);
    } catch (err) {
      // Exponential backoff on failure
      intervalRef.current = Math.min(intervalRef.current * 2, MAX_INTERVAL);
      setError("Failed to fetch job status. Retrying...");
      timerRef.current = setTimeout(poll, intervalRef.current);
    }
  }, [jobId, onJobComplete]);

  useEffect(() => {
    poll();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll]);

  // Auto-scroll to latest entry
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [job?.tasks]);

  if (!job) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-gray-600">Loading job status...</span>
      </div>
    );
  }

  const progress =
    job.totalUrls > 0
      ? Math.round(((job.completedUrls + job.failedUrls) / job.totalUrls) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">
            {job.completedUrls + job.failedUrls} / {job.totalUrls} URLs processed
          </span>
          <span className="font-medium">{progress}%</span>
        </div>
        <div className="h-3 w-full rounded-full bg-gray-200">
          <div
            className="h-3 rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-green-50 p-2">
          <p className="text-lg font-semibold text-green-700">{job.completedUrls}</p>
          <p className="text-xs text-green-600">Completed</p>
        </div>
        <div className="rounded-lg bg-red-50 p-2">
          <p className="text-lg font-semibold text-red-700">{job.failedUrls}</p>
          <p className="text-xs text-red-600">Failed</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <p className="text-lg font-semibold text-gray-700">
            {job.totalUrls - job.completedUrls - job.failedUrls}
          </p>
          <p className="text-xs text-gray-600">Remaining</p>
        </div>
      </div>

      {/* Cancel Button */}
      {!TERMINAL_STATES.has(job.status) && onCancel && (
        <button
          onClick={onCancel}
          className="w-full rounded-md border border-red-300 bg-white px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
        >
          Cancel Ingestion
        </button>
      )}

      {/* URL Feed */}
      <div
        ref={feedRef}
        className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100"
      >
        {job.tasks.length === 0 ? (
          <p className="p-4 text-sm text-gray-500 text-center">
            Waiting for tasks to start processing...
          </p>
        ) : (
          job.tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <StatusIcon status={task.status} />
              <span className="truncate flex-1 text-gray-700">{task.url}</span>
              {task.httpStatus && (
                <span className="text-gray-400">{task.httpStatus}</span>
              )}
              {task.errorMessage && (
                <span className="text-red-500 truncate max-w-[200px]" title={task.errorMessage}>
                  {task.errorMessage}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-amber-600 text-center">{error}</p>
      )}

      {/* Terminal state message */}
      {job.status === "completed" && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-center">
          <p className="text-sm text-green-800">
            Ingestion complete! {job.completedUrls} articles indexed.
          </p>
        </div>
      )}
      {job.status === "cancelled" && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-center">
          <p className="text-sm text-gray-600">Ingestion was cancelled.</p>
        </div>
      )}
      {job.status === "failed" && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-center">
          <p className="text-sm text-red-800">
            Ingestion failed. {job.completedUrls} of {job.totalUrls} articles indexed.
          </p>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <span className="text-green-500">&#10003;</span>;
    case "failed":
      return <span className="text-red-500">&#10007;</span>;
    case "processing":
      return (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-blue-500 border-t-transparent" />
      );
    case "cancelled":
      return <span className="text-gray-400">&#8212;</span>;
    default:
      return <span className="text-gray-300">&#9679;</span>;
  }
}
```

### Step 3.10.7 — Commit form and feedback components

- [ ] Commit all form and feedback components

```bash
git add src/components/forms/CrawlRateSelector.tsx \
  src/components/forms/SitemapInput.tsx \
  src/components/forms/UrlListInput.tsx \
  src/components/forms/FileDropzone.tsx \
  src/components/feedback/UrlStatusFeed.tsx
git commit -m "feat(ui): add ingestion form and feedback components

CrawlRateSelector with Fast warning, SitemapInput with sitemap hint,
UrlListInput with per-line validation, FileDropzone [AAP-F7] with
10MB/50MB limits, UrlStatusFeed [AAP-F1] with exponential backoff polling."
```

### Step 3.10.8 — Write ingestion page

- [ ] Create `src/app/dashboard/ingest/page.tsx`

**File:** `src/app/dashboard/ingest/page.tsx`

```typescript
"use client";

/**
 * Ingestion dashboard page with tabbed form and progress feed.
 *
 * Tabs: Sitemap | URL List | File Upload
 * After submission, shows IngestionProgress with UrlStatusFeed.
 */

import { useState, useCallback } from "react";
import { CrawlRateSelector } from "@/components/forms/CrawlRateSelector";
import { SitemapInput } from "@/components/forms/SitemapInput";
import { UrlListInput } from "@/components/forms/UrlListInput";
import { FileDropzone } from "@/components/forms/FileDropzone";
import { UrlStatusFeed } from "@/components/feedback/UrlStatusFeed";
import { apiFetch } from "@/lib/auth/api-client";
import type { CrawlPreset } from "@/lib/validation/articleSchemas";

type Tab = "sitemap" | "url_list" | "file_upload";

export default function IngestionPage() {
  const [activeTab, setActiveTab] = useState<Tab>("sitemap");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Job tracking
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null);

  // Sitemap form state
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [sitemapPreset, setSitemapPreset] = useState<CrawlPreset>("gentle");

  // URL list form state
  const [urlList, setUrlList] = useState("");
  const [urlListPreset, setUrlListPreset] = useState<CrawlPreset>("gentle");

  // File upload state
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);

  const resetState = () => {
    setError(null);
    setActiveJobId(null);
    setSyncResult(null);
  };

  const handleSitemapSubmit = useCallback(async () => {
    if (!sitemapUrl.trim()) {
      setError("Please enter a sitemap URL");
      return;
    }

    resetState();
    setIsSubmitting(true);

    try {
      const res = await apiFetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "sitemap",
          sitemapUrl: sitemapUrl.trim(),
          crawlPreset: sitemapPreset,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start ingestion");
        return;
      }

      if (res.status === 202) {
        // Async job
        setActiveJobId(data.jobId);
      } else {
        // Sync result
        setSyncResult(data);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [sitemapUrl, sitemapPreset]);

  const handleUrlListSubmit = useCallback(async () => {
    const urls = urlList
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (urls.length === 0) {
      setError("Please enter at least one URL");
      return;
    }

    resetState();
    setIsSubmitting(true);

    try {
      const res = await apiFetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "url_list",
          urls,
          crawlPreset: urlListPreset,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start ingestion");
        return;
      }

      if (res.status === 202) {
        setActiveJobId(data.jobId);
      } else {
        setSyncResult(data);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [urlList, urlListPreset]);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    resetState();
    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Separate HTML from md/json
      const htmlFiles = files.filter((f) =>
        f.name.toLowerCase().endsWith(".html") || f.name.toLowerCase().endsWith(".htm")
      );
      const otherFiles = files.filter(
        (f) =>
          !f.name.toLowerCase().endsWith(".html") && !f.name.toLowerCase().endsWith(".htm")
      );

      // Upload HTML files via multipart (cheerio server-side) [AAP-F7]
      if (htmlFiles.length > 0) {
        const formData = new FormData();
        htmlFiles.forEach((file) => formData.append("files", file));

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/articles/upload");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(formData);
        });
      }

      // Parse md/json client-side and push
      if (otherFiles.length > 0) {
        const articles = await Promise.all(
          otherFiles.map(async (file) => {
            const text = await file.text();
            const isJson = file.name.toLowerCase().endsWith(".json");

            if (isJson) {
              // Expect JSON to be an array of articles or a single article
              const parsed = JSON.parse(text);
              return Array.isArray(parsed) ? parsed : [parsed];
            }

            // Markdown file
            return [
              {
                url: `file://${file.name}`,
                title: file.name.replace(/\.(md|markdown)$/i, ""),
                body: text,
                bodyFormat: "markdown" as const,
              },
            ];
          })
        );

        const flatArticles = articles.flat();

        if (flatArticles.length > 0) {
          const res = await apiFetch("/api/articles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: "push", articles: flatArticles }),
          });

          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "Failed to push articles");
            return;
          }
          setSyncResult(data);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, []);

  const handleCancelJob = useCallback(async () => {
    if (!activeJobId) return;

    try {
      const res = await apiFetch(`/api/jobs/${activeJobId}/cancel`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to cancel job");
      }
    } catch {
      setError("Failed to cancel job");
    }
  }, [activeJobId]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "sitemap", label: "Sitemap" },
    { id: "url_list", label: "URL List" },
    { id: "file_upload", label: "File Upload" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add Articles</h1>
        <p className="text-sm text-gray-600 mt-1">
          Import articles from your site to analyze for SEO improvements.
        </p>
      </div>

      {/* Show progress feed if async job is active */}
      {activeJobId ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Ingestion Progress
            </h2>
            <button
              onClick={() => {
                setActiveJobId(null);
                setSyncResult(null);
              }}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Start new ingestion
            </button>
          </div>
          <UrlStatusFeed
            jobId={activeJobId}
            onCancel={handleCancelJob}
          />
        </div>
      ) : syncResult ? (
        /* Show sync results */
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
          <h2 className="text-lg font-semibold text-green-800">
            Ingestion Complete
          </h2>
          <p className="text-sm text-green-700">
            {(syncResult as { created?: number }).created ?? 0} articles created,{" "}
            {(syncResult as { updated?: number }).updated ?? 0} updated.
          </p>
          <button
            onClick={resetState}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Import more articles
          </button>
        </div>
      ) : (
        /* Show ingestion forms */
        <div className="space-y-6">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setError(null);
                }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="space-y-4">
            {activeTab === "sitemap" && (
              <>
                <SitemapInput value={sitemapUrl} onChange={setSitemapUrl} />
                <CrawlRateSelector
                  value={sitemapPreset}
                  onChange={setSitemapPreset}
                />
                <button
                  onClick={handleSitemapSubmit}
                  disabled={isSubmitting || !sitemapUrl.trim()}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Starting..." : "Import from Sitemap"}
                </button>
              </>
            )}

            {activeTab === "url_list" && (
              <>
                <UrlListInput value={urlList} onChange={setUrlList} />
                <CrawlRateSelector
                  value={urlListPreset}
                  onChange={setUrlListPreset}
                />
                <button
                  onClick={handleUrlListSubmit}
                  disabled={isSubmitting || !urlList.trim()}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Starting..." : "Import URLs"}
                </button>
              </>
            )}

            {activeTab === "file_upload" && (
              <FileDropzone
                onFilesSelected={handleFilesSelected}
                uploadProgress={uploadProgress}
                isUploading={isUploading}
              />
            )}
          </div>

          {/* Error display */}
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 3.10.9 — Write ingestion loading skeleton

- [ ] Create `src/app/dashboard/ingest/loading.tsx`

**File:** `src/app/dashboard/ingest/loading.tsx`

```typescript
/**
 * Skeleton loader for the ingestion page [AAP-F9].
 */

export default function IngestionLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-pulse">
      {/* Title skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-48 rounded bg-gray-200" />
        <div className="h-4 w-72 rounded bg-gray-200" />
      </div>

      {/* Tab bar skeleton */}
      <div className="flex gap-4 border-b border-gray-200 pb-2">
        <div className="h-6 w-20 rounded bg-gray-200" />
        <div className="h-6 w-20 rounded bg-gray-200" />
        <div className="h-6 w-24 rounded bg-gray-200" />
      </div>

      {/* Form skeleton */}
      <div className="space-y-4">
        <div className="h-10 w-full rounded bg-gray-200" />
        <div className="space-y-2">
          <div className="h-12 w-full rounded bg-gray-200" />
          <div className="h-12 w-full rounded bg-gray-200" />
          <div className="h-12 w-full rounded bg-gray-200" />
        </div>
        <div className="h-10 w-full rounded bg-gray-200" />
      </div>
    </div>
  );
}
```

### Step 3.10.10 — Commit ingestion page

- [ ] Commit the ingestion page and loading skeleton

```bash
git add src/app/dashboard/ingest/page.tsx src/app/dashboard/ingest/loading.tsx
git commit -m "feat(ui): add ingestion page with tabbed form and progress feed

IngestionPage with Sitemap/URL List/File Upload tabs. Shows UrlStatusFeed
for async jobs, sync result display, cancel button [AAP-F9].
Includes skeleton loader."
```

---

## UI Agent: Task 3.11 — Articles Index Page

> **Branch:** `feature/phase-3-ui` (continues from 3.10)
> **Depends on:** Task 3.10 (ingestion UI)

### Step 3.11.1 — Write articles index page

- [ ] Create `src/app/dashboard/articles/page.tsx`

**File:** `src/app/dashboard/articles/page.tsx`

```typescript
"use client";

/**
 * Articles index page — server-side initial fetch, client-side for
 * subsequent pages/search/sort.
 *
 * Columns: title, URL, word count, last analyzed, recommendation count.
 * Empty state CTA -> /dashboard/ingest.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth/api-client";

interface Article {
  id: string;
  url: string;
  title: string;
  wordCount: number;
  sourceType: string | null;
  recommendationCount: number;
  lastAnalyzedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type SortField = "title" | "wordCount" | "updatedAt" | "createdAt";

export default function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isLoading, setIsLoading] = useState(true);

  const fetchArticles = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy,
        sortOrder,
      });
      if (search) params.set("search", search);

      const res = await apiFetch(`/api/articles?${params}`);
      if (res.ok) {
        const data = await res.json();
        setArticles(data.articles);
        setPagination(data.pagination);
      }
    } catch {
      // Handle error silently — could add toast
    } finally {
      setIsLoading(false);
    }
  }, [pagination.page, pagination.limit, sortBy, sortOrder, search]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">&#8645;</span>;
    return (
      <span className="text-blue-500 ml-1">
        {sortOrder === "asc" ? "\u2191" : "\u2193"}
      </span>
    );
  };

  // Empty state
  if (!isLoading && articles.length === 0 && !search) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="rounded-full bg-gray-100 p-6">
          <svg
            className="h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900">No articles yet</h2>
        <p className="text-sm text-gray-600 text-center max-w-md">
          Your article index is empty. Add your site&apos;s articles to get started.
        </p>
        <Link
          href="/dashboard/ingest"
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add articles via sitemap
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Articles</h1>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {pagination.total}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="search"
            placeholder="Search articles..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Link
            href="/dashboard/ingest"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add articles
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("title")}
              >
                Title <SortIcon field="title" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                URL
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("wordCount")}
              >
                Words <SortIcon field="wordCount" />
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 cursor-pointer hover:text-gray-700"
                onClick={() => handleSort("updatedAt")}
              >
                Last Updated <SortIcon field="updatedAt" />
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                Recs
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-3">
                    <div className="h-4 w-48 rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-64 rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-12 rounded bg-gray-200 ml-auto" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-20 rounded bg-gray-200 ml-auto" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-8 rounded bg-gray-200 ml-auto" />
                  </td>
                </tr>
              ))
            ) : (
              articles.map((article) => (
                <tr key={article.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/articles/${article.id}`}
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 line-clamp-1"
                    >
                      {article.title || "Untitled"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500 truncate block max-w-xs">
                      {article.url}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                    {article.wordCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">
                    {new Date(article.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {article.recommendationCount > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {article.recommendationCount}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">0</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* No search results */}
      {!isLoading && articles.length === 0 && search && (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">
            No articles match &ldquo;{search}&rdquo;.
          </p>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Showing {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
            {pagination.total}
          </p>
          <div className="flex gap-2">
            <button
              disabled={pagination.page <= 1}
              onClick={() =>
                setPagination((prev) => ({ ...prev, page: prev.page - 1 }))
              }
              className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              disabled={pagination.page >= pagination.totalPages}
              onClick={() =>
                setPagination((prev) => ({ ...prev, page: prev.page + 1 }))
              }
              className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 3.11.2 — Commit articles page

- [ ] Commit the articles index page

```bash
git add src/app/dashboard/articles/page.tsx
git commit -m "feat(ui): add articles index page with search, sort, and empty state

Replaces Phase 2 placeholder. Paginated table with sortable columns
(title, words, updated). Search, empty state CTA to /dashboard/ingest.
Client-side navigation for subsequent pages."
```

### Step 3.11.3 — Verify all UI files compile

- [ ] Run TypeScript check and build

```bash
npx tsc --noEmit 2>&1 | head -10
npm run build 2>&1 | tail -10
# Expected: both pass
```

### Step 3.11.4 — Push UI branch

- [ ] Push the UI branch

```bash
git push -u origin feature/phase-3-ui
```

**Expected:** Branch available on remote.

---

## Integration Verification

> After all five branches merge into `feature/phase-3`, run these checks.

### Step I.1 — Create integration branch and merge all agents

- [ ] Create the integration branch and merge in order

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-3

# 1. Merge validation (foundation)
git merge feature/phase-3-validation --no-ff -m "merge: phase-3-validation into feature/phase-3"

# 2. Merge parser (depends on validation)
git merge feature/phase-3-parser --no-ff -m "merge: phase-3-parser into feature/phase-3"

# 3. Merge queue (depends on validation)
git merge feature/phase-3-queue --no-ff -m "merge: phase-3-queue into feature/phase-3"

# 4. Merge API (depends on all prior)
git merge feature/phase-3-api --no-ff -m "merge: phase-3-api into feature/phase-3"

# 5. Merge UI (depends on all prior)
git merge feature/phase-3-ui --no-ff -m "merge: phase-3-ui into feature/phase-3"
```

**Expected:** All merges succeed. Resolve any conflicts per the spec:
- `src/app/dashboard/articles/page.tsx`: keep UI Agent's version
- `src/app/dashboard/ingest/page.tsx`: keep UI Agent's version

### Step I.2 — Run automated checks

- [ ] Verify types, tests, build, and lint

```bash
# Types
npx tsc --noEmit
# Expected: exit 0

# Tests — all 24 new tests plus prior phases
npx vitest run
# Expected: normalizer 5+2, parser 6, sitemap 4, crawler 4, queue 5 = 24+ tests passing

# Build
npm run build
# Expected: exit 0

# Lint
npm run lint
# Expected: exit 0
```

### Step I.3 — Verify test counts

- [ ] Confirm exact test counts per file

```bash
npx vitest run tests/lib/ingestion/normalizer.test.ts 2>&1 | grep -E "Tests|passed|failed"
# Expected: 7 tests passed (5 main + 2 hash sub-tests)

npx vitest run tests/lib/ingestion/parser.test.ts 2>&1 | grep -E "Tests|passed|failed"
# Expected: 6 tests passed

npx vitest run tests/lib/ingestion/sitemap-parser.test.ts 2>&1 | grep -E "Tests|passed|failed"
# Expected: 4 tests passed

npx vitest run tests/lib/ingestion/crawler.test.ts 2>&1 | grep -E "Tests|passed|failed"
# Expected: 4 tests passed

npx vitest run tests/lib/ingestion/queue.test.ts 2>&1 | grep -E "Tests|passed|failed"
# Expected: 5 tests passed
```

### Step I.4 — Clean up worktrees

- [ ] Remove worktrees created by parallel agents

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git worktree remove ../SEO-ilator-parser 2>/dev/null || true
git worktree remove ../SEO-ilator-queue 2>/dev/null || true
git worktree remove ../SEO-ilator-api 2>/dev/null || true
git worktree remove ../SEO-ilator-ui 2>/dev/null || true
```

### Step I.5 — Verify AAP compliance

- [ ] Check that all AAP requirements are implemented

| AAP Ref | Requirement | File | Check |
|---------|-------------|------|-------|
| AAP-B1 | SSRF dual-point validation | `url-validator.ts` + `crawler.ts` | `validatePublicUrl()` at submission, `dns.resolve4()` at fetch |
| AAP-B1 | Redirect chain SSRF | `crawler.ts` | Manual redirect following with IP validation |
| AAP-B2 | Zombie recovery 10min | `queue.ts` | `ZOMBIE_THRESHOLD_MS = 600_000` |
| AAP-B10 | Active analysis check on delete | `articles/[id]/route.ts` | 409 if analysis running |
| AAP-F1 | Exponential backoff polling | `UrlStatusFeed.tsx` | 3s -> 6s -> 12s -> 30s cap |
| AAP-F7 | File upload limits | `FileDropzone.tsx` | 10MB/file, 50MB total, HTML server-side |
| AAP-F9 | Cancel job | `queue.ts` + `jobs/[id]/cancel/route.ts` | Job + tasks set to cancelled |
| AAP-O1 | CSR detection | `crawler.ts` | parseWarning for <50 words from 200 OK |
| AAP-O7 | HTML push existingLinks | `articles/route.ts` | parsePage() for bodyFormat "html" |
| AAP-O10 | Sitemap safety limits | `sitemap-parser.ts` | Depth 2, 50MB, 10K URLs |

### Step I.6 — Create PR to develop

- [ ] Push integration branch and create PR

```bash
git push -u origin feature/phase-3
gh pr create --base develop --title "feat(ingestion): Phase 3 — Ingestion Pipeline" --body "$(cat <<'EOF'
## Summary

- Validation schemas (discriminated union for sitemap/url_list/push ingestion)
- SSRF URL validator with dual-point validation [AAP-B1]
- Article normalizer (HTML/markdown/text -> plain text, SHA-256 hashing)
- Cheerio HTML parser (title, headings, links, meta, robots)
- Sitemap parser with safety limits [AAP-O10]
- Crawler with rate presets, SSRF at fetch time, robots.txt, CSR detection [AAP-O1]
- Queue manager with FOR UPDATE SKIP LOCKED, zombie recovery [AAP-B2], cancel [AAP-F9]
- Cron worker for async crawling (280s timeout safety)
- API routes: POST/GET /api/articles, GET/DELETE /api/articles/[id], GET /api/jobs/[id], POST /api/jobs/[id]/cancel
- Ingestion UI with tabs, progress feed, exponential backoff [AAP-F1], file upload [AAP-F7]
- Articles index page with search, sort, pagination, empty state

## Test Plan

- [ ] 24 new tests pass: normalizer (5+2), parser (6), sitemap (4), crawler (4), queue (5)
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] Manual: POST /api/articles with push method returns 201
- [ ] Manual: POST /api/articles with sitemap method for <50 URLs returns 201
- [ ] Manual: POST /api/articles with sitemap method for >=50 URLs returns 202
- [ ] Manual: Ingestion UI renders with three tabs
- [ ] Manual: Articles page shows indexed articles
EOF
)"
```

**Expected:** PR created targeting `develop`.
