// src/app/dashboard/runs/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";

export const metadata = { title: "Analysis Runs" };

export default function RunsPage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Analysis Runs
      </h1>
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          No analysis runs yet
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Run your first SEO analysis to see results here.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">Coming soon</p>
      </div>
    </PageContainer>
  );
}
