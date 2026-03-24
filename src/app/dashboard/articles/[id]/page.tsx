// src/app/dashboard/articles/[id]/page.tsx
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";
import { RecommendationsSection } from "./RecommendationsSection";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { projectId } = await requireAuth();
  const db = scopedPrisma(projectId);
  const article = await db.article.findUnique({
    where: { id },
    select: { title: true },
  });
  return { title: article ? `${article.title} — SEO-ilator` : "Article Detail" };
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { projectId } = await requireAuth();
  const db = scopedPrisma(projectId);

  const article = await db.article.findUnique({ where: { id } });
  if (!article) {
    notFound();
  }

  const sourceType = article.sourceType ?? "unknown";
  const wordCount = article.wordCount;
  const createdAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(article.createdAt));
  const updatedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(article.updatedAt));

  return (
    <PageContainer>
      {/* Article metadata */}
      <div className="mb-8">
        <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
          {article.title}
        </h1>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 block truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          {article.url}
        </a>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800 sm:grid-cols-4">
          <div>
            <dt className="font-medium text-gray-500 dark:text-gray-400">
              Word count
            </dt>
            <dd className="mt-0.5 text-gray-900 dark:text-gray-100">
              {wordCount.toLocaleString()}
            </dd>
          </div>

          <div>
            <dt className="font-medium text-gray-500 dark:text-gray-400">
              Source type
            </dt>
            <dd className="mt-0.5 capitalize text-gray-900 dark:text-gray-100">
              {sourceType}
            </dd>
          </div>

          <div>
            <dt className="font-medium text-gray-500 dark:text-gray-400">
              Indexed
            </dt>
            <dd className="mt-0.5 text-gray-900 dark:text-gray-100">
              {createdAt}
            </dd>
          </div>

          <div>
            <dt className="font-medium text-gray-500 dark:text-gray-400">
              Last updated
            </dt>
            <dd className="mt-0.5 text-gray-900 dark:text-gray-100">
              {updatedAt}
            </dd>
          </div>

          {article.httpStatus !== null && (
            <div>
              <dt className="font-medium text-gray-500 dark:text-gray-400">
                HTTP status
              </dt>
              <dd className="mt-0.5 text-gray-900 dark:text-gray-100">
                {article.httpStatus}
              </dd>
            </div>
          )}

          {article.embeddingModel && (
            <div>
              <dt className="font-medium text-gray-500 dark:text-gray-400">
                Embedding model
              </dt>
              <dd className="mt-0.5 text-gray-900 dark:text-gray-100">
                {article.embeddingModel}
              </dd>
            </div>
          )}

          {article.parseWarning && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="font-medium text-amber-600 dark:text-amber-400">
                Parse warning
              </dt>
              <dd className="mt-0.5 text-gray-700 dark:text-gray-300">
                {article.parseWarning}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Recommendations section (client component) */}
      <RecommendationsSection articleId={id} />
    </PageContainer>
  );
}
