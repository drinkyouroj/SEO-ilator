import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { checkPlanLimits } from "@/lib/auth/plan-guard";
import { scopedPrisma } from "@/lib/db";
import { parseHTML, parseMarkdown } from "@/lib/ingestion/parser";
import { normalizeArticle } from "@/lib/ingestion/normalizer";
import type { ParsedArticle } from "@/lib/ingestion/types";

export const dynamic = "force-dynamic";

// ── Zod validation ────────────────────────────────────────────────────────────

const pushSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  body: z.string().min(1),
  bodyFormat: z.enum(["html", "text", "markdown"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ── POST /api/articles/push ───────────────────────────────────────────────────

export async function POST(request: Request) {
  // 1. Auth
  let projectId: string;
  try {
    ({ projectId } = await requireAuth());
  } catch (response) {
    return response as Response;
  }

  // 2. Plan guard — Pro+ only
  const planCheck = await checkPlanLimits(projectId, "api_access");
  if (!planCheck.allowed) {
    return NextResponse.json(
      { error: planCheck.message ?? "Plan limit reached." },
      { status: 403 }
    );
  }

  // 3. Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = pushSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data;

  // 4. Parse content by format
  let parsedArticle: ParsedArticle;

  if (input.bodyFormat === "html") {
    // parseHTML extracts existingLinks from anchor tags [AAP-O7]
    parsedArticle = parseHTML(input.body, input.url);
    // Override title with the caller-supplied value (not the <title> tag)
    parsedArticle = { ...parsedArticle, title: input.title };
  } else if (input.bodyFormat === "markdown") {
    parsedArticle = parseMarkdown(input.body, input.url);
    // Override title with the caller-supplied value
    parsedArticle = { ...parsedArticle, title: input.title };
  } else {
    // bodyFormat === "text": no HTML to parse, so existingLinks must be [] (NOT null) [AAP-O7]
    const wordCount = input.body.trim() ? input.body.trim().split(/\s+/).length : 0;
    parsedArticle = {
      url: input.url,
      title: input.title,
      body: input.body,
      wordCount,
      existingLinks: [],
      metadata: {
        canonical: null,
        metaTitle: null,
        metaDescription: null,
        h1: null,
        h2s: [],
        noindex: false,
        nofollow: false,
        httpStatus: null,
        responseTimeMs: null,
      },
      parseWarning: null,
    };
  }

  // 5. Normalize
  const normalized = normalizeArticle(parsedArticle, projectId, "push");

  // 6. Upsert with hash-based change detection
  const db = scopedPrisma(projectId);

  try {
    const existing = await db.article.findUnique({
      where: { projectId_url: { projectId, url: normalized.url } },
      select: { id: true, bodyHash: true },
    });

    if (existing) {
      if (existing.bodyHash === normalized.bodyHash) {
        const article = await db.article.findUnique({
          where: { projectId_url: { projectId, url: normalized.url } },
        });
        return NextResponse.json({ article, changed: false }, { status: 200 });
      }

      const article = await db.article.update({
        where: { projectId_url: { projectId, url: normalized.url } },
        data: {
          title: normalized.title,
          body: normalized.body,
          bodyHash: normalized.bodyHash,
          titleHash: normalized.titleHash,
          wordCount: normalized.wordCount,
          existingLinks: normalized.existingLinks as never,
          metadata: normalized.metadata as never,
          sourceType: normalized.sourceType,
          parseWarning: normalized.parseWarning,
        },
      });
      return NextResponse.json({ article, changed: true }, { status: 200 });
    }

    const article = await db.article.create({
      data: {
        projectId,
        url: normalized.url,
        title: normalized.title,
        body: normalized.body,
        bodyHash: normalized.bodyHash,
        titleHash: normalized.titleHash,
        wordCount: normalized.wordCount,
        existingLinks: normalized.existingLinks as never,
        metadata: normalized.metadata as never,
        sourceType: normalized.sourceType,
        parseWarning: normalized.parseWarning,
      },
    });
    return NextResponse.json({ article, changed: true }, { status: 201 });
  } catch (err) {
    console.error("[articles/push] Database error:", err);
    return NextResponse.json(
      { error: "Failed to save article" },
      { status: 500 }
    );
  }
}
