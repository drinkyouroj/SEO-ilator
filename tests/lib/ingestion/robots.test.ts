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
