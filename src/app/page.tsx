import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950">
      {/* ── Navigation ── */}
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              S
            </span>
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              SEO-ilator
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <Link
              href="/auth/sign-in"
              className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Sign in
            </Link>
            <Link
              href="/auth/sign-in"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      {/* ── Hero ── */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl dark:text-gray-100">
            Internal crosslinks,{" "}
            <span className="text-blue-600 dark:text-blue-400">automated</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-gray-600 dark:text-gray-400">
            SEO-ilator analyzes your content and finds crosslinking
            opportunities you&apos;re missing. Keyword matching, semantic
            similarity, and quality safeguards — all in one tool.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/auth/sign-in"
              className="rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              Start for free
            </Link>
            <Link
              href="#features"
              className="rounded-lg border border-gray-300 px-6 py-3 text-base font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              See how it works
            </Link>
          </div>
        </div>
      </main>

      {/* ── Features ── */}
      <section
        id="features"
        className="border-t border-gray-200 bg-white px-6 py-24 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-gray-900 dark:text-gray-100">
            How it works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600 dark:text-gray-400">
            Three steps to better internal linking.
          </p>

          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
                1. Ingest your content
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Import via sitemap, URL list, file upload, or API push.
                We crawl and parse your articles automatically.
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
                2. Run analysis
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Keyword matching finds title mentions in body text.
                Semantic matching finds related articles using embeddings.
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
                3. Review and export
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Accept or dismiss recommendations. Copy HTML snippets
                directly into your CMS, or export to CSV.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-200 bg-gray-50 px-6 py-8 dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto max-w-6xl text-center text-sm text-gray-500 dark:text-gray-400">
          SEO-ilator — Open-source SEO crosslink engine
        </div>
      </footer>
    </div>
  );
}
