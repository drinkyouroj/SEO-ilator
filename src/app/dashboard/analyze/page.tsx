"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProgressBar } from "@/components/feedback/ProgressBar";
import { Spinner } from "@/components/feedback/Spinner";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PageContainer } from "@/components/layout/PageContainer";
import { apiFetch } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Polling [AAP-F1] — intervals adjusted to 5s/10s/20s/30s from spec's 3s to reduce load
const INITIAL_INTERVAL = 5000;
const MAX_INTERVAL = 30000;
const BACKOFF_FACTOR = 2;
const MAX_CONSECUTIVE_FAILURES = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageState =
  | "IDLE"
  | "DRY_RUN_LOADING"
  | "DRY_RUN_COMPLETE"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

interface DryRunSummary {
  articleCount: number;
  embeddingsCached: number;
  embeddingsNeeded: number;
  estimatedCost: number;
}

interface RunProgress {
  articlesProcessed: number;
  articlesTotal: number;
  recommendationsFound: number;
  status: string;
  startedAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(startedAt: string | undefined): string {
  if (!startedAt) return "0s";
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}m ${secs}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `< $0.01`;
  return `$${cost.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PreRunSummary({
  summary,
  onStart,
  isStarting,
}: {
  summary: DryRunSummary;
  onStart: () => void;
  isStarting: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
        Pre-run Summary
      </h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-800">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Articles
          </dt>
          <dd className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {summary.articleCount.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-800">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Embeddings Cached
          </dt>
          <dd className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
            {summary.embeddingsCached.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-800">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Embeddings Needed
          </dt>
          <dd className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {summary.embeddingsNeeded.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-800">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Est. Cost
          </dt>
          <dd className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {formatCost(summary.estimatedCost)}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex items-center justify-end">
        <button
          onClick={onStart}
          disabled={isStarting}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {isStarting && <Spinner size={16} />}
          {isStarting ? "Starting…" : "Start Analysis"}
        </button>
      </div>
    </div>
  );
}

function AnalysisProgress({
  progress,
  onCancelClick,
}: {
  progress: RunProgress;
  onCancelClick: () => void;
}) {
  const [, forceUpdate] = useState(0);

  // Re-render every second to keep elapsed time current
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isTerminal =
    progress.status === "completed" ||
    progress.status === "failed" ||
    progress.status === "cancelled";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Analysis in Progress
        </h2>
        {!isTerminal && (
          <button
            onClick={onCancelClick}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
          >
            Cancel
          </button>
        )}
      </div>

      <ProgressBar
        value={progress.articlesTotal > 0 ? progress.articlesProcessed : undefined}
        max={progress.articlesTotal > 0 ? progress.articlesTotal : 100}
        label="Articles processed"
        showCount={progress.articlesTotal > 0}
      />

      <dl className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Articles Processed
          </dt>
          <dd className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {progress.articlesProcessed.toLocaleString()}
            {progress.articlesTotal > 0 && (
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                {" "}/ {progress.articlesTotal.toLocaleString()}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Recommendations Found
          </dt>
          <dd className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {progress.recommendationsFound.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Elapsed
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {formatElapsed(progress.startedAt)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ResultBanner({ state }: { state: "COMPLETED" | "FAILED" | "CANCELLED" }) {
  const configs = {
    COMPLETED: {
      border: "border-green-200 dark:border-green-800",
      bg: "bg-green-50 dark:bg-green-950",
      text: "text-green-800 dark:text-green-200",
      message: "Analysis complete. Recommendations are ready to review.",
    },
    FAILED: {
      border: "border-red-200 dark:border-red-800",
      bg: "bg-red-50 dark:bg-red-950",
      text: "text-red-800 dark:text-red-200",
      message: "Analysis failed. Check logs for details and try again.",
    },
    CANCELLED: {
      border: "border-amber-200 dark:border-amber-800",
      bg: "bg-amber-50 dark:bg-amber-950",
      text: "text-amber-800 dark:text-amber-200",
      message: "Analysis was cancelled.",
    },
  };
  const c = configs[state];
  return (
    <div className={`rounded-lg border p-4 ${c.border} ${c.bg}`}>
      <p className={`text-sm font-medium ${c.text}`}>{c.message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyzePage() {
  const [pageState, setPageState] = useState<PageState>("IDLE");
  const [dryRunSummary, setDryRunSummary] = useState<DryRunSummary | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress>({
    articlesProcessed: 0,
    articlesTotal: 0,
    recommendationsFound: 0,
    status: "running",
  });
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [runsExhausted, setRunsExhausted] = useState(false);
  const [canUseSemantic] = useState(true);

  // ------------------------------------------------------------------
  // Dry run on mount
  // ------------------------------------------------------------------

  const loadDryRun = useCallback(async () => {
    setPageState("DRY_RUN_LOADING");
    setDryRunError(null);
    try {
      const res = await apiFetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      if (res.status === 403) {
        setRunsExhausted(true);
        setPageState("IDLE");
        return;
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setDryRunSummary({
        articleCount: data.articleCount ?? 0,
        embeddingsCached: data.embeddingsCached ?? 0,
        embeddingsNeeded: data.embeddingsNeeded ?? 0,
        estimatedCost: data.estimatedCost ?? 0,
      });
      setPageState("DRY_RUN_COMPLETE");
    } catch (err) {
      setDryRunError(err instanceof Error ? err.message : "Failed to load summary.");
      setPageState("IDLE");
    }
  }, []);

  useEffect(() => {
    loadDryRun();
  }, [loadDryRun]);

  // ------------------------------------------------------------------
  // Start real run
  // ------------------------------------------------------------------

  const handleStartAnalysis = useCallback(async () => {
    setIsStarting(true);
    try {
      const res = await apiFetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status === 403) {
        setRunsExhausted(true);
        return;
      }
      if (res.status !== 202) throw new Error(`Unexpected status: ${res.status}`);
      const data = await res.json();
      setRunId(data.runId);
      setProgress({
        articlesProcessed: 0,
        articlesTotal: 0,
        recommendationsFound: 0,
        status: "running",
        startedAt: new Date().toISOString(),
      });
      setPageState("RUNNING");
    } catch (err) {
      setDryRunError(err instanceof Error ? err.message : "Failed to start analysis.");
    } finally {
      setIsStarting(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Polling [AAP-F1]
  // ------------------------------------------------------------------

  // Use a ref for timeoutId so the visibility handler can always access
  // the current value without going stale.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pageState !== "RUNNING" || !runId) return;

    let interval = INITIAL_INTERVAL;
    let consecutiveFailures = 0;
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await apiFetch(`/api/runs/${runId}`);
        if (!res.ok) throw new Error(`Poll error: ${res.status}`);
        const data = await res.json();
        const run = data.run;

        consecutiveFailures = 0;
        interval = INITIAL_INTERVAL;

        setProgress({
          articlesProcessed: run.articlesProcessed ?? 0,
          articlesTotal: run.articlesTotal ?? 0,
          recommendationsFound: run.recommendationsFound ?? 0,
          status: run.status,
          startedAt: run.startedAt,
        });

        if (
          run.status === "completed" ||
          run.status === "failed" ||
          run.status === "cancelled"
        ) {
          stopped = true;
          const next: PageState =
            run.status === "completed"
              ? "COMPLETED"
              : run.status === "failed"
              ? "FAILED"
              : "CANCELLED";
          setPageState(next);
          return;
        }
      } catch (err) {
        console.error("[analyze] poll failed:", err);
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopped = true;
          setDryRunError("Lost connection to the server. Please refresh the page.");
          setPageState("FAILED");
          return;
        }
        interval = Math.min(interval * BACKOFF_FACTOR, MAX_INTERVAL);
      }

      if (!stopped) {
        timeoutRef.current = setTimeout(poll, interval);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      } else {
        // Page became visible — resume polling immediately
        poll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    poll();

    return () => {
      stopped = true;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pageState, runId]);

  // ------------------------------------------------------------------
  // Cancel [AAP-F4]
  // ------------------------------------------------------------------

  const handleCancelConfirm = useCallback(async () => {
    if (!runId) return;
    setShowCancelDialog(false);
    setIsCancelling(true);
    try {
      await apiFetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      // Polling will pick up the cancelled status naturally
    } catch (err) {
      console.error("[analyze] cancel failed:", err);
      setDryRunError("Failed to cancel analysis. Please try again.");
    } finally {
      setIsCancelling(false);
    }
  }, [runId]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const isTerminal =
    pageState === "COMPLETED" || pageState === "FAILED" || pageState === "CANCELLED";

  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Analyze
      </h1>

      <div className="flex flex-col gap-6">
        {/* Dry-run loading */}
        {pageState === "DRY_RUN_LOADING" && (
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <Spinner size={20} />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Loading pre-run summary…
            </span>
          </div>
        )}

        {/* Dry-run error */}
        {dryRunError && pageState === "IDLE" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
            <p className="text-sm text-red-800 dark:text-red-200">{dryRunError}</p>
            <button
              onClick={loadDryRun}
              className="mt-2 text-sm font-medium text-red-700 underline hover:no-underline dark:text-red-300"
            >
              Retry
            </button>
          </div>
        )}

        {/* Runs exhausted */}
        {runsExhausted && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              You&apos;ve reached your analysis run limit for this month.
            </p>
            <a
              href="/dashboard/settings#account"
              className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            >
              Upgrade for unlimited runs →
            </a>
          </div>
        )}

        {/* Pre-run summary [AAP-O8] */}
        {(pageState === "DRY_RUN_COMPLETE" || isTerminal) && dryRunSummary && (
          <PreRunSummary
            summary={dryRunSummary}
            onStart={handleStartAnalysis}
            isStarting={isStarting}
          />
        )}

        {/* Progress */}
        {(pageState === "RUNNING" || isTerminal) && (
          <AnalysisProgress
            progress={progress}
            onCancelClick={() => setShowCancelDialog(true)}
          />
        )}

        {/* Cancel in-flight indicator */}
        {isCancelling && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <Spinner size={14} />
            <span>Cancelling…</span>
          </div>
        )}

        {/* Terminal result banner */}
        {isTerminal && (
          <ResultBanner
            state={pageState as "COMPLETED" | "FAILED" | "CANCELLED"}
          />
        )}
      </div>

      {/* Cancel confirm dialog [AAP-F4] */}
      <ConfirmDialog
        open={showCancelDialog}
        title="Cancel analysis?"
        description="The current analysis run will be stopped. Any recommendations generated so far will be saved."
        confirmLabel="Yes, cancel"
        cancelLabel="Keep running"
        variant="danger"
        onConfirm={handleCancelConfirm}
        onCancel={() => setShowCancelDialog(false)}
      />
    </PageContainer>
  );
}
