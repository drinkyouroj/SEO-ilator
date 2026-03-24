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
    expect(hash1).toHaveLength(64);
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
