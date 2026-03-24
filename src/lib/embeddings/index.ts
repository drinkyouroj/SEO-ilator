import { prisma } from "@/lib/db";
import { isValidProvider, PROVIDER_DIMENSIONS } from "./providers";
import { OpenAIEmbeddingProvider } from "./providers/openai";
import { CohereEmbeddingProvider } from "./providers/cohere";
import type { EmbeddingProvider } from "./types";

const DEFAULT_PROVIDER = "openai/text-embedding-3-small";

/**
 * Get the configured embedding provider for a project.
 *
 * Resolution order:
 * 1. StrategyConfig table (projectId + strategyId: "embedding")
 * 2. EMBEDDING_PROVIDER environment variable
 * 3. Default: openai/text-embedding-3-small
 */
export async function getProvider(
  projectId: string
): Promise<EmbeddingProvider> {
  const config = await prisma.strategyConfig.findUnique({
    where: {
      projectId_strategyId: { projectId, strategyId: "embedding" },
    },
  });

  // Validate settings shape if config exists
  const rawProvider = (config?.settings as Record<string, unknown>)?.provider;
  if (config && typeof rawProvider !== "string") {
    console.warn(
      `[embeddings] StrategyConfig for project ${projectId} has invalid settings shape. ` +
      `Expected { provider: string }, got: ${JSON.stringify(config.settings)}. Falling back to env/default.`
    );
  }

  const modelId =
    (typeof rawProvider === "string" ? rawProvider : null) ??
    process.env.EMBEDDING_PROVIDER ??
    DEFAULT_PROVIDER;

  if (!isValidProvider(modelId)) {
    throw new Error(
      `Unknown embedding provider: "${modelId}". Valid providers: ${Object.keys(PROVIDER_DIMENSIONS).join(", ")}`
    );
  }

  return createProvider(modelId);
}

function createProvider(modelId: string): EmbeddingProvider {
  switch (modelId) {
    case "openai/text-embedding-3-small":
      return new OpenAIEmbeddingProvider();
    case "cohere/embed-english-v3.0":
      return new CohereEmbeddingProvider();
    default:
      throw new Error(`No adapter for provider: ${modelId}`);
  }
}
