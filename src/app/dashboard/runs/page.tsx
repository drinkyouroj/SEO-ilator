"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { StatusBadge } from "@/components/data/StatusBadge";
import type { Status } from "@/components/data/StatusBadge";
import { EmptyState } from "@/components/data/EmptyState";
import { Pagination } from "@/components/data/Pagination";
import { Spinner } from "@/components/feedback/Spinner";
import { apiFetch } from "@/lib/api-client";

// ---- Types ------------------------------------------------------------------

interface AnalysisRun {
  id: string;
  status: Status;
  articleCount: number;
  recommendationCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
}

interface RunsResponse {
  runs: AnalysisRun[];
  nextCursor: string | null;
}

// ---- Helpers ----------------------------------------------------------------

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDuration(
  startedAt: string | null,
  completedAt: string | null
): string {
  if (!startedAt) return "—";
  if (!completedAt) return "In progress";

  const durationMs =
    new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

const ACTIVE_STATUSES: Status[] = ["pending", "running"];
const POLL_INTERVAL_MS = 5000;

// ---- Page -------------------------------------------------------------------

export default function RunsPage() {
  const router = useRouter();

  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cursor-based pagination: stack of cursors where index 0 = null (first page)
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentCursor = cursorStack[currentPageIndex] ?? null;

  const fetchRuns = useCallback(
    async (cursor: string | null) => {
      try {
        const url = cursor
          ? `/api/runs?cursor=${encodeURIComponent(cursor)}`
          : "/api/runs";
        const res = await apiFetch(url);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`
          );
        }
        const data: RunsResponse = await res.json();
        setRuns(data.runs);
        setNextCursor(data.nextCursor);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load runs");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Initial fetch and page-change fetches
  useEffect(() => {
    setLoading(true);
    fetchRuns(currentCursor);
  }, [currentCursor, fetchRuns]);

  // Auto-polling while any run is in an active state
  useEffect(() => {
    const hasActiveRun = runs.some((r) => ACTIVE_STATUSES.includes(r.status));

    if (hasActiveRun) {
      intervalRef.current = setInterval(() => {
        fetchRuns(currentCursor);
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [runs, currentCursor, fetchRuns]);

  // ---- Pagination handlers --------------------------------------------------

  function handleNextPage() {
    if (!nextCursor) return;
    setCursorStack((prev) => {
      // If we are not at the end of the stack (shouldn't normally happen), trim
      const trimmed = prev.slice(0, currentPageIndex + 1);
      return [...trimmed, nextCursor];
    });
    setCurrentPageIndex((i) => i + 1);
  }

  function handlePrevPage() {
    if (currentPageIndex === 0) return;
    setCurrentPageIndex((i) => i - 1);
  }

  // ---- Row click -----------------------------------------------------------

  function handleRowClick(run: AnalysisRun) {
    router.push(`/dashboard/recommendations?runId=${run.id}`);
  }

  // ---- Render --------------------------------------------------------------

  if (loading && runs.length === 0) {
    return (
      <PageContainer>
        <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Analysis Runs
        </h1>
        <div className="flex items-center justify-center py-20">
          <Spinner size={32} />
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Analysis Runs
        </h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            {error}
          </p>
          <button
            onClick={() => {
              setLoading(true);
              fetchRuns(currentCursor);
            }}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </PageContainer>
    );
  }

  if (runs.length === 0) {
    return (
      <PageContainer>
        <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Analysis Runs
        </h1>
        <EmptyState
          title="No analyses yet"
          description="You haven't run any analyses yet."
          ctaLabel="Run an analysis"
          ctaHref="/dashboard/analyze"
        />
      </PageContainer>
    );
  }

  const hasPrevPage = currentPageIndex > 0;
  const hasNextPage = nextCursor !== null;

  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Analysis Runs
      </h1>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  Timestamp
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  Articles
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  Recommendations
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  Duration
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {runs.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => handleRowClick(run)}
                  className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                    {formatTimestamp(run.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                    {run.articleCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                    {run.recommendationCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(hasPrevPage || hasNextPage) && (
          <Pagination
            currentPage={currentPageIndex + 1}
            hasNextPage={hasNextPage}
            hasPrevPage={hasPrevPage}
            onNextPage={handleNextPage}
            onPrevPage={handlePrevPage}
          />
        )}
      </div>
    </PageContainer>
  );
}
