import { describe, it, expect } from "vitest";
import { settingsUpdateSchema } from "@/lib/validation/settingsSchemas";

describe("settingsUpdateSchema", () => {
  it("accepts_valid_full_settings_update", () => {
    const input = {
      defaultApproaches: ["keyword", "semantic"],
      similarityThreshold: 0.8,
      fuzzyTolerance: 0.9,
      maxLinksPerPage: 15,
      embeddingProvider: "openai",
      forceReEmbed: true,
    };
    const result = settingsUpdateSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(input);
  });

  it("rejects_similarityThreshold_below_0.5", () => {
    const result = settingsUpdateSchema.safeParse({ similarityThreshold: 0.3 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.similarityThreshold).toBeDefined();
      expect(fields.similarityThreshold![0]).toMatch(/at least 0.5/);
    }
  });

  it("rejects_similarityThreshold_above_0.95", () => {
    const result = settingsUpdateSchema.safeParse({ similarityThreshold: 0.99 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.similarityThreshold).toBeDefined();
      expect(fields.similarityThreshold![0]).toMatch(/at most 0.95/);
    }
  });

  it("rejects_maxLinksPerPage_non_integer", () => {
    const result = settingsUpdateSchema.safeParse({ maxLinksPerPage: 5.5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.maxLinksPerPage).toBeDefined();
      expect(fields.maxLinksPerPage![0]).toMatch(/integer/);
    }
  });

  it("rejects_empty_defaultApproaches_array", () => {
    const result = settingsUpdateSchema.safeParse({ defaultApproaches: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.defaultApproaches).toBeDefined();
      expect(fields.defaultApproaches![0]).toMatch(/at least one/i);
    }
  });

  it("rejects_invalid_embeddingProvider", () => {
    const result = settingsUpdateSchema.safeParse({ embeddingProvider: "huggingface" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.embeddingProvider).toBeDefined();
    }
  });

  it("accepts_partial_update_with_only_one_field", () => {
    const result = settingsUpdateSchema.safeParse({ maxLinksPerPage: 20 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ maxLinksPerPage: 20 });
  });

  it("rejects_fuzzyTolerance_below_0.6", () => {
    const result = settingsUpdateSchema.safeParse({ fuzzyTolerance: 0.5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.fuzzyTolerance).toBeDefined();
    }
  });

  it("rejects_fuzzyTolerance_above_1.0", () => {
    const result = settingsUpdateSchema.safeParse({ fuzzyTolerance: 1.1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.fuzzyTolerance).toBeDefined();
    }
  });

  it("rejects_maxLinksPerPage_below_1", () => {
    const result = settingsUpdateSchema.safeParse({ maxLinksPerPage: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects_maxLinksPerPage_above_50", () => {
    const result = settingsUpdateSchema.safeParse({ maxLinksPerPage: 51 });
    expect(result.success).toBe(false);
  });
});
