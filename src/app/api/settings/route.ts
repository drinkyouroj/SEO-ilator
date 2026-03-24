import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { settingsUpdateSchema, DEFAULT_SETTINGS } from "@/lib/validation/settingsSchemas";

export const dynamic = "force-dynamic";

export async function GET() {
  let projectId: string;
  try {
    ({ projectId } = await requireAuth());
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }

  try {
    const config = await prisma.strategyConfig.findUnique({
      where: {
        projectId_strategyId: {
          projectId,
          strategyId: "crosslink",
        },
      },
    });

    const settings = config
      ? { ...DEFAULT_SETTINGS, ...(config.settings as Record<string, unknown>) }
      : { ...DEFAULT_SETTINGS };

    return NextResponse.json({ settings });
  } catch (err) {
    console.error("[api/settings] GET failed:", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let projectId: string;
  try {
    ({ projectId } = await requireAuth());
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const result = settingsUpdateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const update = result.data;

    // Fetch existing config once — used for AAP-B6 check and merge
    const existing = await prisma.strategyConfig.findUnique({
      where: { projectId_strategyId: { projectId, strategyId: "crosslink" } },
    });
    const currentSettings = (existing?.settings as Record<string, unknown>) ?? {};

    // [AAP-B6] If embedding provider is changing, require forceReEmbed confirmation
    if (update.embeddingProvider) {
      const currentProvider = currentSettings.embeddingProvider ?? DEFAULT_SETTINGS.embeddingProvider;

      if (update.embeddingProvider !== currentProvider && !update.forceReEmbed) {
        return NextResponse.json(
          {
            error: "provider_change_requires_confirmation",
            message:
              "Switching providers invalidates all cached embeddings. " +
              "A full re-embed will be required on the next analysis run. " +
              "Send forceReEmbed: true to confirm.",
          },
          { status: 400 },
        );
      }
    }

    // Strip forceReEmbed from persisted settings (it is a one-time flag)
    const { forceReEmbed, ...settingsToPersist } = update;

    // Merge with existing settings so partial updates don't wipe other fields
    const mergedSettings = { ...DEFAULT_SETTINGS, ...currentSettings, ...settingsToPersist };

    const config = await prisma.strategyConfig.upsert({
      where: { projectId_strategyId: { projectId, strategyId: "crosslink" } },
      create: {
        projectId,
        strategyId: "crosslink",
        settings: mergedSettings,
      },
      update: {
        settings: mergedSettings,
      },
    });

    // If forceReEmbed was requested, clear all article embeddings for this project
    // Isolated from the settings save — settings are already persisted at this point
    let embeddingsCleared = false;
    if (forceReEmbed) {
      try {
        await prisma.$executeRaw`
          UPDATE "Article"
          SET embedding = NULL, "embeddingModel" = NULL
          WHERE "projectId" = ${projectId}
        `;
        embeddingsCleared = true;
      } catch (clearErr) {
        console.error("[api/settings] Failed to clear embeddings after provider switch:", clearErr);
        return NextResponse.json({
          settings: config.settings,
          embeddingsCleared: false,
          warning: "Settings saved but embedding cache could not be cleared. Please retry.",
        });
      }
    }

    return NextResponse.json({
      settings: config.settings,
      embeddingsCleared,
    });
  } catch (err) {
    console.error("[api/settings] PUT failed:", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
