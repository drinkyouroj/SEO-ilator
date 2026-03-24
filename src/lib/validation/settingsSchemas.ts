import { z } from "zod";

export const settingsUpdateSchema = z.object({
  defaultApproaches: z
    .array(z.enum(["keyword", "semantic"]))
    .min(1, "At least one matching approach is required")
    .optional(),
  similarityThreshold: z
    .number()
    .min(0.5, "Similarity threshold must be at least 0.5")
    .max(0.95, "Similarity threshold must be at most 0.95")
    .optional(),
  fuzzyTolerance: z
    .number()
    .min(0.6, "Fuzzy tolerance must be at least 0.6")
    .max(1.0, "Fuzzy tolerance must be at most 1.0")
    .optional(),
  maxLinksPerPage: z
    .number()
    .int("Max links per page must be an integer")
    .min(1, "Max links per page must be at least 1")
    .max(50, "Max links per page must be at most 50")
    .optional(),
  embeddingProvider: z.enum(["openai", "cohere"]).optional(),
  forceReEmbed: z.boolean().optional(),
});

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export const DEFAULT_SETTINGS: Required<Omit<SettingsUpdate, "forceReEmbed">> = {
  defaultApproaches: ["keyword"],
  similarityThreshold: 0.75,
  fuzzyTolerance: 0.8,
  maxLinksPerPage: 10,
  embeddingProvider: "openai",
};
