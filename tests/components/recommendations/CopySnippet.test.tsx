import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CopySnippet } from "@/components/recommendations/CopySnippet";

describe("CopySnippet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("generates_correct_html_from_anchor_and_url", () => {
    render(<CopySnippet anchorText="Learn React" targetUrl="https://example.com/react" />);
    const preview = screen.getByTestId("snippet-preview");
    expect(preview.textContent).toContain('<a href="https://example.com/react">Learn React</a>');
  });

  it("updates_html_when_anchor_text_edited", () => {
    render(<CopySnippet anchorText="Original" targetUrl="https://example.com" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Updated Text" } });
    const preview = screen.getByTestId("snippet-preview");
    expect(preview.textContent).toContain("Updated Text");
  });

  it("escapes_special_characters_in_anchor_text", () => {
    render(<CopySnippet anchorText='Text "quotes" & <tags>' targetUrl="https://example.com" />);
    const preview = screen.getByTestId("snippet-preview");
    const text = preview.textContent ?? "";
    expect(text).toContain("&amp;");
    expect(text).toContain("&lt;");
    expect(text).toContain("&quot;");
  });

  it("escapes_special_characters_in_target_url", () => {
    render(<CopySnippet anchorText="Link" targetUrl='https://example.com/path?a=1&b="2"' />);
    const preview = screen.getByTestId("snippet-preview");
    const text = preview.textContent ?? "";
    expect(text).toContain("&amp;");
  });

  it("calls_clipboard_api_on_copy", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopySnippet anchorText="Test" targetUrl="https://example.com" />);
    const copyButton = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('<a href="https://example.com">Test</a>')
    );
  });

  it("falls_back_to_execCommand_when_clipboard_api_unavailable", () => {
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    render(<CopySnippet anchorText="Test" targetUrl="https://example.com" />);
    const copyButton = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyButton);

    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
