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
