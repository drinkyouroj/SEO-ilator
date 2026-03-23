// src/app/dashboard/analyze/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";

export const metadata = { title: "Analyze" };

export default function AnalyzePage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Analyze
      </h1>
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Ready to analyze
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Select articles and strategies to run an SEO analysis. Ingest articles first if you haven&apos;t already.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">Coming soon</p>
      </div>
    </PageContainer>
  );
}
