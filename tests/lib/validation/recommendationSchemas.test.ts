import { describe, it, expect } from "vitest";
import {
  updateRecommendationSchema,
  bulkUpdateSchema,
  recommendationFilterSchema,
} from "@/lib/validation/recommendationSchemas";

describe("updateRecommendationSchema", () => {
  const valid = {
    status: "accepted",
    updatedAt: "2026-03-24T12:00:00.000Z",
  };

  it("accepts_valid_accepted_status", () => {
    const result = updateRecommendationSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts_dismissed_with_reason", () => {
    const result = updateRecommendationSchema.safeParse({
      status: "dismissed",
      updatedAt: "2026-03-24T12:00:00.000Z",
      dismissReason: "Not relevant",
    });
    expect(result.success).toBe(true);
  });

  it("rejects_pending_status", () => {
    const result = updateRecommendationSchema.safeParse({
      ...valid,
      status: "pending",
    });
    expect(result.success).toBe(false);
  });

  it("rejects_superseded_status", () => {
    const result = updateRecommendationSchema.safeParse({
      ...valid,
      status: "superseded",
    });
    expect(result.success).toBe(false);
  });

  it("rejects_missing_updatedAt", () => {
    const result = updateRecommendationSchema.safeParse({ status: "accepted" });
    expect(result.success).toBe(false);
  });

  it("rejects_invalid_datetime", () => {
    const result = updateRecommendationSchema.safeParse({
      status: "accepted",
      updatedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects_dismissReason_over_500_chars", () => {
    const result = updateRecommendationSchema.safeParse({
      status: "dismissed",
      updatedAt: "2026-03-24T12:00:00.000Z",
      dismissReason: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe("bulkUpdateSchema", () => {
  it("accepts_valid_bulk_update", () => {
    const result = bulkUpdateSchema.safeParse({
      ids: ["id-1", "id-2"],
      status: "accepted",
    });
    expect(result.success).toBe(true);
  });

  it("rejects_empty_ids_array", () => {
    const result = bulkUpdateSchema.safeParse({ ids: [], status: "accepted" });
    expect(result.success).toBe(false);
  });

  it("rejects_ids_over_500", () => {
    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const result = bulkUpdateSchema.safeParse({ ids, status: "dismissed" });
    expect(result.success).toBe(false);
  });

  it("rejects_pending_status", () => {
    const result = bulkUpdateSchema.safeParse({
      ids: ["id-1"],
      status: "pending",
    });
    expect(result.success).toBe(false);
  });
});

describe("recommendationFilterSchema", () => {
  it("accepts_empty_params_with_defaults", () => {
    const result = recommendationFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("coerces_limit_from_string", () => {
    const result = recommendationFilterSchema.safeParse({ limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  it("clamps_limit_to_max_100", () => {
    const result = recommendationFilterSchema.safeParse({ limit: "200" });
    expect(result.success).toBe(false);
  });

  it("accepts_all_valid_severity_values", () => {
    for (const sev of ["critical", "warning", "info"]) {
      const result = recommendationFilterSchema.safeParse({ severity: sev });
      expect(result.success).toBe(true);
    }
  });

  it("accepts_superseded_in_filter_status", () => {
    const result = recommendationFilterSchema.safeParse({ status: "superseded" });
    expect(result.success).toBe(true);
  });

  it("rejects_invalid_format", () => {
    const result = recommendationFilterSchema.safeParse({ format: "xml" });
    expect(result.success).toBe(false);
  });
});
