import { z } from "zod";

/** Schema for PATCH /api/recommendations/[id] — accept or dismiss */
export const updateRecommendationSchema = z.object({
  status: z.enum(["accepted", "dismissed"]),
  dismissReason: z.string().max(500).optional(),
  /** [AAP-B12] For optimistic locking — must match the current updatedAt */
  updatedAt: z.string().datetime(),
});

/** Schema for PATCH /api/recommendations/bulk — bulk status update */
export const bulkUpdateSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  status: z.enum(["accepted", "dismissed"]),
  dismissReason: z.string().max(500).optional(),
});

/** Schema for GET /api/recommendations query params */
export const recommendationFilterSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]).optional(),
  status: z.enum(["pending", "accepted", "dismissed", "superseded"]).optional(),
  analysisRunId: z.string().optional(),
  articleId: z.string().optional(),
  format: z.enum(["json", "csv"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});
