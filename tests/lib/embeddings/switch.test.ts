import { describe, it, expect, vi, beforeEach } from "vitest";
import { switchProvider } from "@/lib/embeddings/switch";

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
}));

describe("switchProvider", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("clears_all_embeddings_and_updates_config", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(10),
        strategyConfig: { upsert: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    await switchProvider("proj-1", "cohere/embed-english-v3.0");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // REINDEX attempted after transaction
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("rejects_unknown_model_id", async () => {
    await expect(
      switchProvider("proj-1", "unknown/model-xyz")
    ).rejects.toThrow("Unknown embedding provider");
  });
});
