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
    expect(ssrfGuard.validateUrl).toHaveBeenCalledTimes(2);
  });

  it("stops_after_max_redirects", async () => {
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
