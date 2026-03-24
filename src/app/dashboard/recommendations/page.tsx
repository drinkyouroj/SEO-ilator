"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RecommendationCard } from "@/components/data/RecommendationCard";
import { EmptyState } from "@/components/data/EmptyState";
import { Pagination } from "@/components/data/Pagination";
import { Spinner } from "@/components/feedback/Spinner";
import { ErrorBanner } from "@/components/feedback/ErrorBanner";
import { useToast } from "@/components/feedback/ToastProvider";
import { apiFetch } from "@/lib/api-client";

type Severity = "critical" | "warning" | "info";
type RecStatus = "pending" | "accepted" | "dismissed";

interface Recommendation {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  anchorText?: string | null;
  confidence: number;
  matchingApproach?: string | null;
  status: RecStatus;
  updatedAt: string;
  sourceArticle?: { title: string; url: string } | null;
  targetArticle?: { title: string; url: string } | null;
}

const PAGE_SIZE = 20;

const SEVERITIES: Severity[] = ["critical", "warning", "info"];
const STATUS_TABS: { label: string; value: RecStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Accepted", value: "accepted" },
  { label: "Dismissed", value: "dismissed" },
];

async function downloadExport(
  runId: string,
  format: "csv" | "json",
  addToast: (t: { message: string; variant: "error" | "success" }) => void,
) {
  try {
    const res = await apiFetch(
      `/api/recommendations?format=${format}&analysisRunId=${encodeURIComponent(runId)}`,
    );
    if (!res.ok) {
      const data = await res.json().catch((parseErr: unknown) => {
        console.error("[RecommendationsPage] failed to parse error response:", {
          status: res.status,
          parseErr,
        });
        return {};
      });
      addToast({
        message:
          (data as { message?: string }).message ?? `Export failed (${res.status})`,
        variant: "error",
      });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recommendations.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    addToast({ message: "Export failed. Please try again.", variant: "error" });
  }
}

function RecommendationsPageContent() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId");
  const { addToast } = useToast();

  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);

  // Filters
  const [activeSeverities, setActiveSeverities] = useState<Set<Severity>>(
    new Set(SEVERITIES),
  );
  const [activeStatus, setActiveStatus] = useState<RecStatus | "all">("all");

  // Selection for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // IDs currently in-flight for single or bulk PATCH
  const [pending, setPending] = useState<Set<string>>(new Set());

  const fetchRecs = useCallback(
    async (cursorParam: string | null) => {
      if (!runId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          analysisRunId: runId,
          limit: String(PAGE_SIZE),
        });
        if (activeStatus !== "all") params.set("status", activeStatus);
        if (cursorParam) params.set("cursor", cursorParam);

        const res = await apiFetch(`/api/recommendations?${params.toString()}`);
        if (!res.ok) {
          const json = await res.json().catch((parseErr: unknown) => {
            console.error("[RecommendationsPage] failed to parse error response:", {
              status: res.status,
              parseErr,
            });
            return {};
          });
          throw new Error(
            (json as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }
        const json = (await res.json()) as {
          recommendations: Recommendation[];
          nextCursor: string | null;
        };
        setRecs(json.recommendations);
        setNextCursor(json.nextCursor);
        setSelected(new Set());
      } catch (err) {
        if (err instanceof Error && err.message === "Session expired") return;
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [runId, activeStatus],
  );

  // Re-fetch when status tab or runId changes; reset pagination
  useEffect(() => {
    setCursor(null);
    setCursorHistory([null]);
    setPageIndex(0);
    fetchRecs(null);
  }, [fetchRecs]);

  // --- Optimistic single accept/dismiss ---
  const handleSingle = useCallback(
    async (id: string, newStatus: "accepted" | "dismissed") => {
      const rec = recs.find((r) => r.id === id);
      if (!rec) return;

      setRecs((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, status: newStatus as RecStatus } : r,
        ),
      );
      setPending((prev) => new Set(prev).add(id));

      try {
        const res = await apiFetch(`/api/recommendations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus, updatedAt: rec.updatedAt }),
        });

        if (!res.ok) {
          const json = await res.json().catch((parseErr: unknown) => {
            console.error("[RecommendationsPage] failed to parse error response:", {
              status: res.status,
              parseErr,
            });
            return {};
          });
          throw new Error(
            (json as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        const json = (await res.json()) as { recommendation: Recommendation };
        setRecs((prev) =>
          prev.map((r) => (r.id === id ? json.recommendation : r)),
        );
      } catch (err) {
        setRecs((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: rec.status } : r)),
        );
        const message =
          err instanceof Error && err.message !== "Session expired"
            ? err.message
            : "Failed to update recommendation.";
        addToast({ message, variant: "error" });
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [recs, addToast],
  );

  const handleAccept = useCallback(
    (id: string) => handleSingle(id, "accepted"),
    [handleSingle],
  );
  const handleDismiss = useCallback(
    (id: string) => handleSingle(id, "dismissed"),
    [handleSingle],
  );

  // --- Bulk accept/dismiss ---
  const handleBulk = useCallback(
    async (newStatus: "accepted" | "dismissed") => {
      const ids = Array.from(selected);
      if (ids.length === 0) return;

      const snapshots = new Map(recs.map((r) => [r.id, r.status]));

      setRecs((prev) =>
        prev.map((r) =>
          ids.includes(r.id) ? { ...r, status: newStatus as RecStatus } : r,
        ),
      );
      setPending((prev) => new Set([...prev, ...ids]));
      setSelected(new Set());

      try {
        const res = await apiFetch("/api/recommendations/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, status: newStatus }),
        });

        if (!res.ok) {
          const json = await res.json().catch((parseErr: unknown) => {
            console.error("[RecommendationsPage] failed to parse error response:", {
              status: res.status,
              parseErr,
            });
            return {};
          });
          throw new Error(
            (json as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        addToast({
          message: `${ids.length} recommendation${ids.length !== 1 ? "s" : ""} ${newStatus}.`,
          variant: "success",
        });
      } catch (err) {
        setRecs((prev) =>
          prev.map((r) =>
            snapshots.has(r.id)
              ? { ...r, status: snapshots.get(r.id) as RecStatus }
              : r,
          ),
        );
        setSelected(new Set(ids));
        const message =
          err instanceof Error && err.message !== "Session expired"
            ? err.message
            : "Bulk update failed.";
        addToast({ message, variant: "error" });
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [selected, recs, addToast],
  );

  // --- Pagination ---
  const handleNextPage = useCallback(() => {
    if (!nextCursor) return;
    const newIndex = pageIndex + 1;
    setCursorHistory((prev) => {
      const next = [...prev];
      next[newIndex] = nextCursor;
      return next;
    });
    setPageIndex(newIndex);
    setCursor(nextCursor);
    fetchRecs(nextCursor);
  }, [nextCursor, pageIndex, fetchRecs]);

  const handlePrevPage = useCallback(() => {
    if (pageIndex === 0) return;
    const newIndex = pageIndex - 1;
    const prevCursor = cursorHistory[newIndex] ?? null;
    setPageIndex(newIndex);
    setCursor(prevCursor);
    fetchRecs(prevCursor);
  }, [pageIndex, cursorHistory, fetchRecs]);

  // --- Severity filter (client-side on current page) ---
  const visibleRecs = recs.filter((r) => activeSeverities.has(r.severity));

  const toggleSeverity = (s: Severity) => {
    setActiveSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        if (next.size === 1) return prev;
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectableIds = visibleRecs
      .filter((r) => r.status === "pending" && !pending.has(r.id))
      .map((r) => r.id);
    const allSelected = selectableIds.every((id) => selected.has(id));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...selectableIds]));
    }
  };

  const selectableCount = visibleRecs.filter(
    (r) => r.status === "pending" && !pending.has(r.id),
  ).length;
  const allSelectableSelected =
    selectableCount > 0 &&
    visibleRecs
      .filter((r) => r.status === "pending" && !pending.has(r.id))
      .every((r) => selected.has(r.id));

  // No runId provided
  if (!runId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          title="No analysis run selected"
          description="Navigate from the Runs page to view recommendations for a specific analysis run."
          ctaLabel="View runs"
          ctaHref="/dashboard/runs"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Recommendations
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Run{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800">
              {runId.slice(0, 8)}
            </code>
          </p>
        </div>

        {/* Export buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => downloadExport(runId, "csv", addToast)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => downloadExport(runId, "json", addToast)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveStatus(tab.value)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              activeStatus === tab.value
                ? "border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Severity filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Severity:
        </span>
        {SEVERITIES.map((s) => (
          <label key={s} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={activeSeverities.has(s)}
              onChange={() => toggleSeverity(s)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs capitalize text-gray-600 dark:text-gray-400">
              {s}
            </span>
          </label>
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-900/30">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={() => handleBulk("accepted")}
            className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={() => handleBulk("dismissed")}
            className="rounded-md bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Dismiss all
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size={32} />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <ErrorBanner
          message={error}
          onRetry={() => fetchRecs(cursor)}
          className="mb-4"
        />
      )}

      {/* Empty state */}
      {!loading && !error && visibleRecs.length === 0 && (
        <EmptyState
          title="No recommendations found"
          description="This analysis run produced no recommendations matching your current filters."
          ctaLabel="View runs"
          ctaHref="/dashboard/runs"
        />
      )}

      {/* Recommendation list */}
      {!loading && !error && visibleRecs.length > 0 && (
        <>
          {/* Select all row */}
          {selectableCount > 0 && (
            <div className="mb-2 flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={allSelectableSelected}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Select all pending ({selectableCount})
              </label>
            </div>
          )}

          <ul className="space-y-3">
            {visibleRecs.map((rec) => (
              <li key={rec.id} className="flex items-start gap-3">
                {rec.status === "pending" && (
                  <div className="mt-5 flex-shrink-0">
                    <input
                      type="checkbox"
                      aria-label={`Select "${rec.title}"`}
                      checked={selected.has(rec.id)}
                      disabled={pending.has(rec.id)}
                      onChange={() => toggleSelect(rec.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <RecommendationCard
                    recommendation={{
                      ...rec,
                      targetUrl: rec.targetArticle?.url,
                      status: pending.has(rec.id) ? "pending" : rec.status,
                    }}
                    onAccept={pending.has(rec.id) ? () => {} : handleAccept}
                    onDismiss={pending.has(rec.id) ? () => {} : handleDismiss}
                  />
                  {/* Source / target article context */}
                  {(rec.sourceArticle || rec.targetArticle) && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      {rec.sourceArticle && (
                        <span>
                          From:{" "}
                          <a
                            href={rec.sourceArticle.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {rec.sourceArticle.title}
                          </a>
                        </span>
                      )}
                      {rec.targetArticle && (
                        <span>
                          To:{" "}
                          <a
                            href={rec.targetArticle.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {rec.targetArticle.title}
                          </a>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <Pagination
            currentPage={pageIndex + 1}
            hasNextPage={!!nextCursor}
            hasPrevPage={pageIndex > 0}
            onNextPage={handleNextPage}
            onPrevPage={handlePrevPage}
            className="mt-4"
          />
        </>
      )}
    </div>
  );
}

export default function RecommendationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Spinner size={32} />
        </div>
      }
    >
      <RecommendationsPageContent />
    </Suspense>
  );
}
