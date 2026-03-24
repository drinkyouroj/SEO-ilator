"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Spinner } from "@/components/feedback/Spinner";
import { ErrorBanner } from "@/components/feedback/ErrorBanner";
import { EmptyState } from "@/components/data/EmptyState";
import { Pagination } from "@/components/data/Pagination";
import { apiFetch } from "@/lib/api-client";

interface ArticleSummary {
  id: string;
  url: string;
  title: string | null;
  wordCount: number | null;
  sourceType: string | null;
  createdAt: string;
  updatedAt: string;
}

function truncateUrl(url: string, maxLen = 60): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 1) + "\u2026";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ArticlesPage() {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchArticles = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const res = await apiFetch(`/api/articles?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load articles (${res.status})`);
      const data = await res.json();
      setArticles(data.articles ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load articles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const handleNextPage = useCallback(() => {
    if (!nextCursor) return;
    const lastArticle = articles[0];
    if (lastArticle) {
      setCursorStack((prev) => [...prev, lastArticle.id]);
    }
    setCurrentPage((p) => p + 1);
    fetchArticles(nextCursor);
  }, [nextCursor, articles, fetchArticles]);

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => {
      const stack = [...prev];
      stack.pop();
      const prevCursor = stack.length > 0 ? stack[stack.length - 1] : undefined;
      fetchArticles(prevCursor);
      return stack;
    });
    setCurrentPage((p) => Math.max(1, p - 1));
  }, [fetchArticles]);

  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Articles
      </h1>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size={24} />
        </div>
      )}

      {error && !loading && (
        <ErrorBanner message={error} onRetry={() => fetchArticles()} />
      )}

      {!loading && !error && articles.length === 0 && (
        <EmptyState
          title="No articles yet"
          description="Ingest your first batch of articles to start analyzing SEO opportunities."
          ctaLabel="Ingest Articles"
          ctaHref="/dashboard/ingest"
        />
      )}

      {!loading && !error && articles.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    URL
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Word Count
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                {articles.map((article) => (
                  <tr
                    key={article.id}
                    className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <Link
                        href={`/dashboard/articles/${article.id}`}
                        className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {article.title || "Untitled"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      <span title={article.url}>{truncateUrl(article.url)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                      {article.wordCount?.toLocaleString() ?? "\u2014"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {article.sourceType ?? "\u2014"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(article.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={currentPage}
            hasNextPage={!!nextCursor}
            hasPrevPage={currentPage > 1}
            onNextPage={handleNextPage}
            onPrevPage={handlePrevPage}
          />
        </div>
      )}
    </PageContainer>
  );
}
