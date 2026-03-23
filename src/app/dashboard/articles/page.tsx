// src/app/dashboard/articles/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";

export const metadata = { title: "Articles" };

export default function ArticlesPage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Articles
      </h1>
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          No articles yet
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Ingest your first batch of articles to start analyzing SEO opportunities.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">Coming soon</p>
      </div>
    </PageContainer>
  );
}
