import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSitemap } from "@/lib/ingestion/sitemap";

vi.mock("@/lib/ingestion/ssrf-guard", () => ({
  validateUrl: vi.fn().mockResolvedValue({
    safe: true,
    resolvedIp: "93.184.216.34",
  }),
}));

import * as ssrfGuard from "@/lib/ingestion/ssrf-guard";

describe("parseSitemap", () => {
  beforeEach(() => {
    vi.mocked(ssrfGuard.validateUrl).mockResolvedValue({
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

  it("rejects_ssrf_unsafe_url", async () => {
    vi.mocked(ssrfGuard.validateUrl).mockResolvedValue({
      safe: false,
      reason: "Resolved to private IP: 192.168.1.1",
    });

    const result = await parseSitemap("https://internal.example.com/sitemap.xml");
    expect(result.urls).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("SSRF") || w.includes("unsafe") || w.includes("private"))).toBe(true);
  });

  it("skips_ssrf_unsafe_child_sitemaps", async () => {
    const index = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://internal.example.com/sitemap-posts.xml</loc></sitemap>
      </sitemapindex>`;

    global.fetch = vi.fn().mockResolvedValue(new Response(index, { status: 200 }));

    vi.mocked(ssrfGuard.validateUrl)
      .mockResolvedValueOnce({ safe: true, resolvedIp: "93.184.216.34" })
      .mockResolvedValueOnce({ safe: false, reason: "Resolved to private IP: 10.0.0.1" });

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.urls).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("SSRF") || w.includes("unsafe") || w.includes("skipped"))).toBe(true);
  });

  it("returns_warning_on_fetch_failure", async () => {
    vi.mocked(ssrfGuard.validateUrl).mockResolvedValue({ safe: true, resolvedIp: "93.184.216.34" });
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.urls).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns_warning_on_non_200_response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));

    const result = await parseSitemap("https://example.com/sitemap.xml");
    expect(result.urls).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("404") || w.includes("status"))).toBe(true);
  });
});
