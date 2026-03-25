"use client";

import { useCallback, useRef, useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Spinner } from "@/components/feedback/Spinner";
import { ErrorBanner } from "@/components/feedback/ErrorBanner";
import { apiFetch } from "@/lib/api-client";

type IngestStatus = "idle" | "submitting" | "success" | "error";
type TriggerStatus = "idle" | "triggering" | "triggered" | "error";

interface FeedbackState {
  status: IngestStatus;
  message: string | null;
}

export default function IngestPage() {
  // ── Manual trigger ───────────────────────────────────────────────────────
  const [crawlTrigger, setCrawlTrigger] = useState<TriggerStatus>("idle");
  const [analyzeTrigger, setAnalyzeTrigger] = useState<TriggerStatus>("idle");

  const handleTrigger = useCallback(async (job: "crawl" | "analyze") => {
    const setter = job === "crawl" ? setCrawlTrigger : setAnalyzeTrigger;
    setter("triggering");
    try {
      const res = await apiFetch("/api/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      if (!res.ok) throw new Error("Trigger failed");
      setter("triggered");
      setTimeout(() => setter("idle"), 5000);
    } catch {
      setter("error");
      setTimeout(() => setter("idle"), 5000);
    }
  }, []);

  // Auto-trigger crawl after successful ingestion submission
  const triggerCrawl = useCallback(() => {
    if (crawlTrigger === "idle") handleTrigger("crawl");
  }, [crawlTrigger, handleTrigger]);

  // ── Sitemap form ──────────────────────────────────────────────────────────
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [sitemapFeedback, setSitemapFeedback] = useState<FeedbackState>({
    status: "idle",
    message: null,
  });

  const handleSitemapSubmit = useCallback(async () => {
    if (!sitemapUrl.trim()) return;
    setSitemapFeedback({ status: "submitting", message: null });
    try {
      const res = await apiFetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "sitemap", url: sitemapUrl.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Server error: ${res.status}`);
      }
      setSitemapFeedback({
        status: "success",
        message: "Sitemap submitted. Processing will start shortly.",
      });
      setSitemapUrl("");
      triggerCrawl();
    } catch (err) {
      setSitemapFeedback({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to start sitemap crawl.",
      });
    }
  }, [sitemapUrl]);

  // ── URL list form ─────────────────────────────────────────────────────────
  const [urlList, setUrlList] = useState("");
  const [urlListFeedback, setUrlListFeedback] = useState<FeedbackState>({
    status: "idle",
    message: null,
  });

  const handleUrlListSubmit = useCallback(async () => {
    const urls = urlList
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    setUrlListFeedback({ status: "submitting", message: null });
    try {
      const res = await apiFetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "url_list", urls }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Server error: ${res.status}`);
      }
      setUrlListFeedback({
        status: "success",
        message: `${urls.length} URL${urls.length === 1 ? "" : "s"} submitted. Processing will start shortly.`,
      });
      setUrlList("");
      triggerCrawl();
    } catch (err) {
      setUrlListFeedback({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to start URL crawl.",
      });
    }
  }, [urlList]);

  // ── File upload form ──────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadFeedback, setUploadFeedback] = useState<FeedbackState>({
    status: "idle",
    message: null,
  });
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFilesSelected = useCallback((files: FileList | null) => {
    if (!files) return;
    setSelectedFiles(Array.from(files));
    setUploadFeedback({ status: "idle", message: null });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFilesSelected(e.dataTransfer.files);
    },
    [handleFilesSelected],
  );

  const handleUploadSubmit = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setUploadFeedback({ status: "submitting", message: null });
    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("files", file);
      }
      const res = await apiFetch("/api/articles/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Server error: ${res.status}`);
      }
      setUploadFeedback({
        status: "success",
        message: `Uploaded ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} successfully.`,
      });
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadFeedback({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to upload files.",
      });
    }
  }, [selectedFiles]);

  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Ingest Articles
      </h1>

      <div className="flex flex-col gap-8">
        {/* ── Sitemap ────────────────────────────────────────────────────── */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Crawl Sitemap
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Provide a sitemap.xml URL to automatically discover and crawl all listed pages.
          </p>
          <div className="flex gap-3">
            <input
              type="url"
              value={sitemapUrl}
              onChange={(e) => setSitemapUrl(e.target.value)}
              placeholder="https://example.com/sitemap.xml"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
            />
            <button
              onClick={handleSitemapSubmit}
              disabled={!sitemapUrl.trim() || sitemapFeedback.status === "submitting"}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {sitemapFeedback.status === "submitting" && <Spinner size={14} />}
              Crawl Sitemap
            </button>
          </div>
          <FeedbackMessage feedback={sitemapFeedback} />
        </section>

        {/* ── URL List ───────────────────────────────────────────────────── */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Crawl URL List
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Paste one URL per line. Each page will be fetched and parsed.
          </p>
          <textarea
            value={urlList}
            onChange={(e) => setUrlList(e.target.value)}
            placeholder={"https://example.com/blog/post-1\nhttps://example.com/blog/post-2"}
            rows={5}
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
          <button
            onClick={handleUrlListSubmit}
            disabled={!urlList.trim() || urlListFeedback.status === "submitting"}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {urlListFeedback.status === "submitting" && <Spinner size={14} />}
            Crawl URLs
          </button>
          <FeedbackMessage feedback={urlListFeedback} />
        </section>

        {/* ── File Upload ────────────────────────────────────────────────── */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Upload Files
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Upload HTML, Markdown, or JSON files containing article content.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`mb-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors ${
              isDragOver
                ? "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-950"
                : "border-gray-300 bg-gray-50 hover:border-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-gray-500"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="mb-2 h-8 w-8 text-gray-400 dark:text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {selectedFiles.length > 0
                ? `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected`
                : "Drop files here or click to browse"}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              .html, .md, .json
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm,.md,.markdown,.json"
              multiple
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
          </div>
          <button
            onClick={handleUploadSubmit}
            disabled={selectedFiles.length === 0 || uploadFeedback.status === "submitting"}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {uploadFeedback.status === "submitting" && <Spinner size={14} />}
            Upload Files
          </button>
          <FeedbackMessage feedback={uploadFeedback} />
        </section>

        {/* ── Manual Triggers ──────────────────────────────────────────── */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Process Jobs
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Manually trigger background jobs. These also run automatically on a schedule.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => handleTrigger("crawl")}
              disabled={crawlTrigger === "triggering"}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {crawlTrigger === "triggering" && <Spinner size={14} />}
              {crawlTrigger === "triggered" ? "Crawl Triggered" : "Process Crawl Queue"}
            </button>
            <button
              onClick={() => handleTrigger("analyze")}
              disabled={analyzeTrigger === "triggering"}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {analyzeTrigger === "triggering" && <Spinner size={14} />}
              {analyzeTrigger === "triggered" ? "Analysis Triggered" : "Run Analysis"}
            </button>
          </div>
          {crawlTrigger === "triggered" && (
            <p className="mt-3 text-sm font-medium text-green-700 dark:text-green-400">
              Crawl job triggered. Check the Articles page for progress.
            </p>
          )}
          {analyzeTrigger === "triggered" && (
            <p className="mt-3 text-sm font-medium text-green-700 dark:text-green-400">
              Analysis triggered. Check the Runs page for progress.
            </p>
          )}
          {(crawlTrigger === "error" || analyzeTrigger === "error") && (
            <p className="mt-3 text-sm font-medium text-red-700 dark:text-red-400">
              Failed to trigger job. Please try again.
            </p>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function FeedbackMessage({ feedback }: { feedback: FeedbackState }) {
  if (!feedback.message) return null;
  if (feedback.status === "success") {
    return (
      <p className="mt-3 text-sm font-medium text-green-700 dark:text-green-400">
        {feedback.message}
      </p>
    );
  }
  if (feedback.status === "error") {
    return <ErrorBanner message={feedback.message} className="mt-3" />;
  }
  return null;
}
