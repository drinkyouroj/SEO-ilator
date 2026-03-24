# DECISION: Security Review v1.0

**Date:** 2026-03-24
**Status:** Accepted

## Context

Pre-release security review covering OWASP top 10 and project-specific concerns
identified during the Phase 8 hardening milestone. This review examines the codebase
on branch `feature/phase-8-testing-hardening` for common web application vulnerabilities,
supply chain risks, and SEO-ilator-specific attack surfaces (SSRF via crawler, XSS via
recommendation snippets, bundle leakage of server-only libraries).

## Checklist Results

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | No API keys in client bundle | PASS | `.env.example` exposes only `NEXT_PUBLIC_APP_URL` (a non-secret URL). All secrets (`AUTH_SECRET`, `OPENAI_API_KEY`, `COHERE_API_KEY`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`, `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`, `CRON_SECRET`) are server-only env vars. The single `NEXT_PUBLIC_` reference in source (`src/app/layout.tsx`) reads `NEXT_PUBLIC_APP_URL` for metadata, which is safe. |
| 2 | SSRF protection [AAP-B1] | PASS (with caveat) | `ssrf-guard.ts` validates URLs before fetch, resolves DNS via `resolve4`, rejects all RFC 1918/loopback/link-local/zero IPs, and checks ALL resolved addresses. `crawler.ts` uses `redirect: "manual"` and SSRF-validates every redirect hop. **Caveat:** only IPv4 is checked (`resolve4`). A dual-stack host with a private IPv6 address (e.g., `::1`, `fc00::/7`) could bypass the guard if Node's `fetch` prefers the AAAA record. See Finding F1. |
| 3 | CORS not enabled on authenticated endpoints | PASS | No `Access-Control-Allow-Origin` headers are set anywhere in `src/app/api/`. The project does not use a CORS middleware or `cors` package. |
| 4 | Rate limiting on endpoints [AAP-B9] | FAIL | `src/lib/rate-limit.ts` exists with a well-implemented token-bucket algorithm and configs for `POST:/api/articles` (10/min) and `POST:/api/analyze` (5/hr). However, `checkRateLimit` is **not imported or called** in any API route handler under `src/app/api/`. The rate limiter is dead code. See Finding F2. |
| 5 | npm audit | DEFERRED | Unable to execute `npm audit` due to environment restrictions. Must be run manually: `npm audit --audit-level=critical`. |
| 6 | File upload size limits | PASS | `src/app/api/articles/upload/route.ts` enforces 10MB per-file limit, 50MB total limit, and an allowlist of extensions (`.html`, `.htm`, `.md`, `.markdown`, `.json`). Empty files are rejected. Auth is required via `requireAuth()`. |
| 7 | HTML sanitization on crawled content | PASS (acceptable risk) | `parser.ts` uses cheerio to strip `<script>`, `<style>`, and `<noscript>` elements before extracting text. Body content is reduced to plain text via `.text()` which inherently strips HTML. Metadata fields (title, description, h1, h2s) are extracted as text content, not raw HTML. The stored `body` field is plain text, not HTML, so stored XSS via crawled content is not a concern. No dedicated sanitizer (DOMPurify) is used, but the text-extraction approach achieves the same goal for this use case. |
| 8 | CopySnippet escaping [AAP-F3] | PASS | `escapeHtml` in `CopySnippet.tsx` correctly escapes all five required characters: `&` to `&amp;`, `<` to `&lt;`, `>` to `&gt;`, `"` to `&quot;`, `'` to `&#39;`. The escape is applied to both `anchorText` and `targetUrl` before interpolation into the `<a>` tag HTML string. The order is correct (`&` is replaced first). |
| 9 | cheerio not in client bundle [AAP-F10] | PASS | cheerio is imported only in `src/lib/ingestion/parser.ts` and `src/lib/ingestion/sitemap.ts`, both server-only modules under `lib/`. No `"use client"` component imports cheerio. `next.config.ts` lists `cheerio` in `serverExternalPackages`, preventing it from being bundled into client chunks. |
| 10 | SQL injection protection | PASS | All raw SQL in `src/` uses Prisma tagged template literals (`$executeRaw\`...\``, `$queryRaw\`...\``), which are automatically parameterized. No instances of `$executeRawUnsafe` or `$queryRawUnsafe` exist in source. No string concatenation is used to build SQL. |

## Findings

### F1 — SSRF guard does not check IPv6 (Severity: Medium)

**Location:** `src/lib/ingestion/ssrf-guard.ts`

`validateUrl` calls `dnsPromises.resolve4()` which only resolves A records (IPv4). If a
target hostname also has AAAA records pointing to private IPv6 addresses (`::1`,
`fd00::/8`, `fe80::/10`), and Node's `fetch` implementation prefers IPv6, the SSRF
guard would pass validation while the actual connection reaches a private address.

**Remediation:** Add `dnsPromises.resolve6()` alongside `resolve4()` and implement an
`isPrivateIp6()` check for IPv6 private ranges (`::1`, `fc00::/7`, `fe80::/10`,
`::ffff:127.0.0.1` mapped addresses). Both address families must pass for the URL
to be considered safe.

### F2 — Rate limiter is implemented but not wired into routes (Severity: High)

**Location:** `src/lib/rate-limit.ts` (implemented), `src/app/api/` (not integrated)

The rate limiter has correct configuration for `POST:/api/articles` and
`POST:/api/analyze`, but `checkRateLimit` is never imported or called by any route
handler. This means all endpoints are unprotected against abuse. A single user could
trigger unlimited analysis runs or flood the article ingestion endpoint.

**Remediation:** Import and call `checkRateLimit` at the top of `POST` handlers in:
- `src/app/api/articles/route.ts`
- `src/app/api/analyze/route.ts`
- `src/app/api/articles/upload/route.ts`

Alternatively, wire it into middleware for broader coverage.

### F3 — npm audit not yet run (Severity: Unknown)

`npm audit --audit-level=critical` must be run manually before release. This was not
executable during the automated review. Add this check to CI if not already present.

## Consequences

1. **F2 (rate limiting) must be fixed before production release.** Without rate limiting, the analysis endpoint (which calls external embedding APIs with cost implications) is vulnerable to abuse and cost amplification attacks.
2. **F1 (IPv6 SSRF) should be fixed before production release** if the deployment environment supports IPv6. If deployed behind a proxy that only uses IPv4, this is lower priority but should still be addressed.
3. **F3 (npm audit) must be verified manually** by a developer running `npm audit --audit-level=critical` and addressing any findings.
4. All other checklist items pass. The codebase demonstrates good security practices overall: parameterized queries throughout, proper HTML escaping, server-only imports for heavy parsing libraries, auth gates on all mutating endpoints, and file upload validation.
