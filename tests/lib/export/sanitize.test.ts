import { describe, it, expect } from "vitest";
import { sanitizeCell } from "@/lib/export/sanitize";

describe("sanitizeCell", () => {
  it("prefixes_equals_sign_with_quote", () => {
    expect(sanitizeCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
  });

  it("prefixes_plus_sign_with_quote", () => {
    expect(sanitizeCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
  });

  it("prefixes_minus_sign_with_quote", () => {
    expect(sanitizeCell("-1+1")).toBe("'-1+1");
  });

  it("prefixes_at_sign_with_quote", () => {
    expect(sanitizeCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("passes_through_normal_text", () => {
    expect(sanitizeCell("Normal article title")).toBe("Normal article title");
  });

  it("handles_empty_string", () => {
    expect(sanitizeCell("")).toBe("");
  });
});
