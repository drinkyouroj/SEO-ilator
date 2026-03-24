import Link from "next/link";

export const metadata = { title: "Authentication Error" };

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "Sign-in was denied. This can happen if the database is not yet configured or if there was an issue creating your account. Please try again or contact support.",
  Configuration:
    "There is a problem with the server configuration. Please contact support.",
  Verification:
    "The verification link has expired or has already been used. Please request a new one.",
  Default:
    "An unexpected error occurred during sign-in. Please try again.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorCode = error ?? "Default";
  const message = ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <svg
            className="h-8 w-8 text-red-600 dark:text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Authentication Error
        </h1>

        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          {message}
        </p>

        {errorCode !== "Default" && (
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            Error code: {errorCode}
          </p>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/auth/sign-in"
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Try again
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
