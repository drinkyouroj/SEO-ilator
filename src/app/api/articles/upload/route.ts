import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";
import { parseHTML } from "@/lib/ingestion/parser";
import { parseMarkdown } from "@/lib/ingestion/parser";
import { normalizeArticle } from "@/lib/ingestion/normalizer";

export const dynamic = "force-dynamic";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXTENSIONS = new Set([".html", ".htm", ".md", ".markdown", ".json"]);

// ── JSON manifest schema ─────────────────────────────────────────────────────

const jsonManifestSchema = z.array(
  z.object({
    url: z.string().url(),
    title: z.string().min(1),
    body: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

// ── POST /api/articles/upload ────────────────────────────────────────────────

export async function POST(request: Request) {
  // 1. Auth
  let projectId: string;
  try {
    ({ projectId } = await requireAuth());
  } catch (response) {
    return response as Response;
  }

  // 2. Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse form data" }, { status: 400 });
  }

  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  // 3. Validate file sizes and extensions
  let totalSize = 0;
  for (const file of files) {
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Invalid file entry in form data" }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: `File "${file.name}" is empty` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds the 10MB per-file limit` },
        { status: 400 }
      );
    }

    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          error: `File "${file.name}" has unsupported extension "${ext}". Allowed: .html, .htm, .md, .markdown, .json`,
        },
        { status: 400 }
      );
    }

    totalSize += file.size;
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json(
      { error: `Total upload size exceeds the 50MB limit` },
      { status: 400 }
    );
  }

  // 4. Process each file
  const db = scopedPrisma(projectId);
  let created = 0;
  let updated = 0;
  const warnings: string[] = [];

  for (const file of files) {
    const ext = getExtension(file.name);
    let content: string;

    try {
      content = await file.text();
    } catch {
      warnings.push(`Failed to read file "${file.name}" — skipped`);
      continue;
    }

    if (ext === ".json") {
      // JSON manifest: array of { url, title, body, metadata? }
      let rawJson: unknown;
      try {
        rawJson = JSON.parse(content);
      } catch {
        warnings.push(`File "${file.name}" is not valid JSON — skipped`);
        continue;
      }

      const parsed = jsonManifestSchema.safeParse(rawJson);
      if (!parsed.success) {
        warnings.push(
          `File "${file.name}" failed schema validation: ${parsed.error.issues.map((i) => i.message).join(", ")} — skipped`
        );
        continue;
      }

      for (const entry of parsed.data) {
        // Build a minimal ParsedArticle from manifest entry
        const parsedArticle = {
          url: entry.url,
          title: entry.title,
          body: entry.body,
          wordCount: entry.body ? entry.body.split(/\s+/).length : 0,
          existingLinks: [],
          metadata: {
            canonical: null,
            metaTitle: entry.title,
            metaDescription: null,
            h1: null,
            h2s: [],
            noindex: false,
            nofollow: false,
            httpStatus: null,
            responseTimeMs: null,
            ...(entry.metadata ?? {}),
          },
          parseWarning: null,
        };

        const normalized = normalizeArticle(parsedArticle, projectId, "upload");

        const { didCreate, didUpdate, skipped } = await upsertArticle(db, projectId, normalized);
        if (didCreate) created++;
        if (didUpdate) updated++;
        if (skipped && normalized.parseWarning) {
          warnings.push(`${normalized.url}: ${normalized.parseWarning}`);
        }
      }
    } else {
      // HTML or Markdown
      const syntheticUrl = `upload://${file.name}`;
      let parsedArticle;

      try {
        if (ext === ".html" || ext === ".htm") {
          parsedArticle = parseHTML(content, syntheticUrl);
        } else {
          // .md or .markdown
          parsedArticle = parseMarkdown(content, syntheticUrl);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Parse error";
        warnings.push(`File "${file.name}" failed to parse: ${msg} — skipped`);
        continue;
      }

      const normalized = normalizeArticle(parsedArticle, projectId, "upload");

      const { didCreate, didUpdate } = await upsertArticle(db, projectId, normalized);
      if (didCreate) created++;
      if (didUpdate) updated++;
      if (normalized.parseWarning) {
        warnings.push(`${file.name}: ${normalized.parseWarning}`);
      }
    }
  }

  return NextResponse.json({ created, updated, warnings }, { status: 200 });
}

// ── Upsert helper ────────────────────────────────────────────────────────────

async function upsertArticle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  projectId: string,
  normalized: ReturnType<typeof normalizeArticle>
): Promise<{ didCreate: boolean; didUpdate: boolean; skipped: boolean }> {
  const existing = await db.article.findFirst({
    where: { url: normalized.url },
    select: { id: true, bodyHash: true },
  });

  if (!existing) {
    await db.article.create({
      data: {
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
        httpStatus: normalized.metadata.httpStatus,
      },
    });
    return { didCreate: true, didUpdate: false, skipped: false };
  }

  // If bodyHash is unchanged, skip the update
  if (existing.bodyHash === normalized.bodyHash) {
    return { didCreate: false, didUpdate: false, skipped: true };
  }

  await db.article.update({
    where: { id: existing.id },
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
      httpStatus: normalized.metadata.httpStatus,
    },
  });
  return { didCreate: false, didUpdate: true, skipped: false };
}
