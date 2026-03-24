"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { ThresholdSlider } from "@/components/forms/ThresholdSlider";

interface SettingsData {
  defaultApproaches: Array<"keyword" | "semantic">;
  similarityThreshold: number;
  fuzzyTolerance: number;
  maxLinksPerPage: number;
  embeddingProvider: "openai" | "cohere" | "groq";
}

interface UserPlan {
  plan: string;
  runsThisMonth: number;
  runLimit: number;
  articlesIndexed: number;
  articleLimit: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

/**
 * Settings page with three sections:
 * 1. StrategySettingsSection — sliders and selectors for analysis config
 * 2. AdvancedSection — embedding provider, force re-embed [AAP-B6]
 * 3. AccountSection — plan badge, usage stats, upgrade CTA
 */
export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [planInfo, setPlanInfo] = useState<UserPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showProviderWarning, setShowProviderWarning] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<"openai" | "cohere" | "groq" | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Fetch current settings on mount
  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error("Failed to fetch settings");
        const data = await res.json();
        setSettings(data.settings);
        setPlanInfo(data.plan ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const saveSettings = useCallback(
    async (updates: Partial<SettingsData> & { forceReEmbed?: boolean }) => {
      setSaveStatus("saving");
      setError(null);
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || data.error || "Failed to save");
        }
        const data = await res.json();
        setSettings((prev) => (prev ? { ...prev, ...data.settings } : prev));
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
        setSaveStatus("error");
      }
    },
    []
  );

  // Debounced save for slider/input changes (500ms)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useMemo(() => debounce(saveSettings, 500), [saveSettings]);

  // [AAP-B6] Provider switch confirmation handler
  const handleProviderChange = useCallback(
    (provider: "openai" | "cohere" | "groq") => {
      if (settings && provider !== settings.embeddingProvider) {
        setPendingProvider(provider);
        setShowProviderWarning(true);
      }
    },
    [settings]
  );

  const confirmProviderSwitch = useCallback(() => {
    if (pendingProvider) {
      // Don't optimistically update provider — let saveSettings sync from server on success
      saveSettings({
        embeddingProvider: pendingProvider,
        forceReEmbed: true,
      });
    }
    setShowProviderWarning(false);
    setPendingProvider(null);
  }, [pendingProvider, saveSettings]);

  const cancelProviderSwitch = useCallback(() => {
    setShowProviderWarning(false);
    setPendingProvider(null);
  }, []);

  if (loading) return null; // loading.tsx handles skeleton
  if (error && !settings)
    return (
      <div className="p-6">
        <p className="text-red-500">{error}</p>
      </div>
    );
  if (!settings)
    return (
      <div className="p-6">
        <p className="text-red-500">Settings could not be loaded. Please refresh the page.</p>
      </div>
    );

  return (
    <div className="space-y-8 p-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure analysis strategies and account preferences.
        </p>
      </div>

      {/* ── StrategySettingsSection ── */}
      <section aria-labelledby="strategy-heading" className="space-y-6">
        <h2
          id="strategy-heading"
          className="text-lg font-semibold text-gray-900 dark:text-white"
        >
          Strategy Configuration
        </h2>

        <ThresholdSlider
          name="similarityThreshold"
          label="Similarity Threshold"
          value={settings.similarityThreshold}
          min={0.5}
          max={0.95}
          step={0.01}
          onChange={(v) => {
            setSettings((prev) =>
              prev ? { ...prev, similarityThreshold: v } : prev
            );
            debouncedSave({ similarityThreshold: v });
          }}
          description="Minimum cosine similarity score for semantic matching. Higher values produce fewer but more relevant recommendations."
        />

        <ThresholdSlider
          name="fuzzyTolerance"
          label="Fuzzy Matching Tolerance"
          value={settings.fuzzyTolerance}
          min={0.6}
          max={1.0}
          step={0.01}
          onChange={(v) => {
            setSettings((prev) =>
              prev ? { ...prev, fuzzyTolerance: v } : prev
            );
            debouncedSave({ fuzzyTolerance: v });
          }}
          description="String similarity threshold for keyword matching. 1.0 = exact match only."
        />

        <div className="space-y-2">
          <label
            htmlFor="maxLinksPerPage"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Max Links Per Page
          </label>
          <input
            type="number"
            id="maxLinksPerPage"
            name="maxLinksPerPage"
            min={1}
            max={50}
            value={settings.maxLinksPerPage}
            onChange={(e) => {
              const v = Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1));
              setSettings((prev) =>
                prev ? { ...prev, maxLinksPerPage: v } : prev
              );
              debouncedSave({ maxLinksPerPage: v });
            }}
            className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Maximum number of crosslink recommendations per article (1–50).
          </p>
        </div>

        <div className="space-y-2">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Default Matching Approaches
          </span>
          <div className="flex gap-4">
            {(["keyword", "semantic"] as const).map((approach) => (
              <label key={approach} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.defaultApproaches.includes(approach)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...settings.defaultApproaches, approach]
                      : settings.defaultApproaches.filter((a) => a !== approach);
                    if (next.length > 0) {
                      setSettings((prev) =>
                        prev ? { ...prev, defaultApproaches: next } : prev
                      );
                      debouncedSave({ defaultApproaches: next });
                    }
                  }}
                  className="rounded border-gray-300 focus-visible:ring-2 focus-visible:ring-blue-500"
                />
                <span className="capitalize">{approach}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* ── AdvancedSection (collapsible) ── */}
      <section aria-labelledby="advanced-heading">
        <button
          id="advanced-heading"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded"
          aria-expanded={advancedOpen}
          aria-controls="advanced-content"
        >
          <svg
            className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Advanced
        </button>

        {advancedOpen && (
          <div id="advanced-content" className="mt-4 space-y-4 pl-6">
            <div className="space-y-2">
              <label
                htmlFor="embeddingProvider"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Embedding Provider
              </label>
              <select
                id="embeddingProvider"
                value={settings.embeddingProvider}
                onChange={(e) =>
                  handleProviderChange(e.target.value as "openai" | "cohere" | "groq")
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="openai">OpenAI (text-embedding-3-small)</option>
                <option value="cohere">Cohere (embed-english-v3.0)</option>
                <option value="groq">Groq (llama3-embedding-large)</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {/* [AAP-B6] Provider switch confirmation dialog */}
      {showProviderWarning && (
        <div
          role="alertdialog"
          aria-labelledby="provider-warning-title"
          aria-describedby="provider-warning-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3
              id="provider-warning-title"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              Switch Embedding Provider?
            </h3>
            <p
              id="provider-warning-desc"
              className="mt-2 text-sm text-gray-600 dark:text-gray-300"
            >
              Switching providers invalidates all cached embeddings. A full
              re-embed will be required on the next analysis run. This may incur
              additional API costs.
            </p>
            <div className="mt-4 flex gap-3 justify-end">
              <button
                onClick={cancelProviderSwitch}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={confirmProviderSwitch}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-500"
              >
                Switch Provider & Clear Embeddings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AccountSection ── */}
      <section aria-labelledby="account-heading" className="space-y-4">
        <h2
          id="account-heading"
          className="text-lg font-semibold text-gray-900 dark:text-white"
        >
          Account
        </h2>

        {planInfo && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Plan:
              </span>
              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {planInfo.plan.charAt(0).toUpperCase() + planInfo.plan.slice(1)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">
                  Runs this month
                </span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {planInfo.runsThisMonth} / {planInfo.runLimit}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">
                  Articles indexed
                </span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {planInfo.articlesIndexed} / {planInfo.articleLimit}
                </p>
              </div>
            </div>

            {planInfo.plan === "free" && (
              <button className="mt-2 rounded-md bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2 text-sm font-medium text-white hover:from-blue-700 hover:to-purple-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                Upgrade to Pro
              </button>
            )}
          </div>
        )}
      </section>

      {/* Save status indicator */}
      {saveStatus !== "idle" && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${
            saveStatus === "saving"
              ? "bg-blue-100 text-blue-800"
              : saveStatus === "saved"
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
          }`}
        >
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "saved" && "Settings saved"}
          {saveStatus === "error" && (error ?? "Failed to save")}
        </div>
      )}
    </div>
  );
}
