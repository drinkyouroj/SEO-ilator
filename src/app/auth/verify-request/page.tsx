// src/app/auth/verify-request/page.tsx
"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/layout/AuthLayout";
import Link from "next/link";

const RESEND_COOLDOWN_SECONDS = 60;

function VerifyRequestPageContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "your inbox";

  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  // Countdown timer for resend throttle
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || resendStatus === "sending") return;

    setResendStatus("sending");
    try {
      await signIn("email", {
        email,
        redirect: false,
        callbackUrl: "/dashboard/articles",
      });
      setResendStatus("sent");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setResendStatus("error");
    }
  }, [email, resendCooldown, resendStatus]);

  return (
    <AuthLayout>
      <div className="text-center">
        {/* Email icon */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-blue-600 dark:text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
          Check your email
        </h2>

        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          We sent a sign-in link to{" "}
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {email}
          </span>
          . The link expires in 10 minutes.
        </p>

        {/* Resend button */}
        <button
          onClick={handleResend}
          disabled={resendCooldown > 0 || resendStatus === "sending"}
          className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {resendStatus === "sending"
            ? "Sending..."
            : resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : resendStatus === "sent"
                ? "Sent! Resend again"
                : "Resend magic link"}
        </button>

        {resendStatus === "error" && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            Could not resend the magic link. Please try again.
          </p>
        )}

        {/* [AAP-F8] Sign in a different way */}
        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <Link
            href="/auth/sign-in"
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Sign in a different way
          </Link>
        </div>

        {/* Troubleshooting tips [AAP-F8] */}
        <div className="mt-6 rounded-lg bg-gray-50 p-4 text-left dark:bg-gray-800/50">
          <h3 className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            Troubleshooting
          </h3>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
            <li>Check your spam or junk folder.</li>
            <li>Make sure you entered the correct email address.</li>
            <li>
              If you use a corporate email, ask your IT team to whitelist{" "}
              <span className="font-mono text-gray-900 dark:text-gray-100">
                noreply@seo-ilator.com
              </span>
              .
            </li>
          </ul>
        </div>
      </div>
    </AuthLayout>
  );
}

export default function VerifyRequestPage() {
  return (
    <Suspense>
      <VerifyRequestPageContent />
    </Suspense>
  );
}
