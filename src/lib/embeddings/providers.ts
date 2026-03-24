/**
 * Static provider dimension mapping.
 * Used by zero-padding logic and provider switching validation.
 */

export const PROVIDER_DIMENSIONS: Record<string, number> = {
  "openai/text-embedding-3-small": 1536,
  "cohere/embed-english-v3.0": 1024,
  "groq/llama3-embedding-large": 1024,
};

/** All vectors are stored at this fixed dimension in pgvector. */
export const STORAGE_DIMENSIONS = 1536;

/** Validate that a model ID is a known provider. */
export function isValidProvider(modelId: string): boolean {
  return modelId in PROVIDER_DIMENSIONS;
}
