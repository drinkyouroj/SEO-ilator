"use client";

/**
 * [AAP-F5] Global fetch wrapper for client-side API calls.
 *
 * Intercepts 401 responses and redirects to /auth/sign-in with callbackUrl.
 * All client-side fetch calls in dashboard components MUST use apiFetch
 * instead of raw fetch.
 */

type ToastFn = (message: string) => void;

let toastHandler: ToastFn | null = null;

/**
 * Register a toast handler for session expiry notifications.
 * Call this once from your root layout or toast provider.
 */
export function registerToastHandler(handler: ToastFn): void {
  toastHandler = handler;
}

/**
 * Fetch wrapper that handles 401 session expiry.
 * Redirects to sign-in page and shows a toast notification.
 */
export async function apiFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);

  if (res.status === 401) {
    const callbackUrl = encodeURIComponent(window.location.pathname);

    // [AAP-F5] Show toast on session expiry during optimistic updates
    if (toastHandler) {
      toastHandler("Your session has expired. Please sign in again.");
    }

    window.location.href = `/auth/sign-in?callbackUrl=${callbackUrl}`;
    throw new Error("Session expired");
  }

  return res;
}
