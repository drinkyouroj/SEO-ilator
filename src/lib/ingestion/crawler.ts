import { validateUrl } from "./ssrf-guard";
import { RobotsCache } from "./robots";
import type { CrawlPreset, FailureType } from "./types";

const USER_AGENT = "SEO-ilator/1.0 (+https://seo-ilator.com/bot)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface CrawlUrlResult {
  html: string;
  httpStatus: number;
  responseTimeMs: number;
  redirectChain: string[];
  error?: string;
  failureType?: FailureType;
}

/**
 * Fetches and caches robots.txt for a domain.
 * SSRF-validates the robots.txt URL before fetching.
 * If validation fails or fetch fails, sets the cache to "" (allow all).
 */
export async function fetchRobotsTxt(
  domain: string,
  robotsCache: RobotsCache
): Promise<void> {
  if (robotsCache.has(domain)) return;

  const robotsUrl = `https://${domain}/robots.txt`;
  const robotsValidation = await validateUrl(robotsUrl);

  if (!robotsValidation.safe) {
    // Can't validate the robots.txt URL safely — allow all
    robotsCache.set(domain, "");
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const robotsRes = await fetch(robotsUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      if (robotsRes.status === 200) {
        const text = await robotsRes.text();
        robotsCache.set(domain, text);
      } else {
        robotsCache.set(domain, "");
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // If robots.txt fetch fails, treat as allow-all
    robotsCache.set(domain, "");
  }
}

/**
 * Fetches a single URL with SSRF protection, robots.txt compliance,
 * and manual redirect-chain validation.
 *
 * The caller is responsible for pre-populating the RobotsCache (via
 * fetchRobotsTxt) before calling crawlUrl if robots.txt enforcement
 * is required. If the domain is not in the cache, crawlUrl allows
 * access by default (RobotsCache.check returns allowed: true for
 * uncached domains).
 */
export async function crawlUrl(
  url: string,
  _preset: CrawlPreset,
  robotsCache: RobotsCache
): Promise<CrawlUrlResult> {
  const startTime = Date.now();

  // Step 1: SSRF-validate the initial URL
  const ssrfResult = await validateUrl(url);
  if (!ssrfResult.safe) {
    return {
      html: "",
      httpStatus: 0,
      responseTimeMs: Date.now() - startTime,
      redirectChain: [],
      error: ssrfResult.reason ?? "SSRF validation failed",
      failureType: "ssrf",
    };
  }

  // Step 2: Check robots.txt (cache must be pre-populated by caller)
  const robotsCheck = robotsCache.check(url, USER_AGENT);
  if (!robotsCheck.allowed) {
    return {
      html: "",
      httpStatus: 0,
      responseTimeMs: Date.now() - startTime,
      redirectChain: [],
      error: "Blocked by robots.txt",
      failureType: "robots",
    };
  }

  // Step 3: Fetch with manual redirect following + per-hop SSRF validation
  let currentUrl = url;
  const redirectChain: string[] = [];
  let lastStatus = 0;

  try {
    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": USER_AGENT },
        });
      } finally {
        clearTimeout(timer);
      }

      lastStatus = response.status;

      // 3xx redirect
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            html: "",
            httpStatus: response.status,
            responseTimeMs: Date.now() - startTime,
            redirectChain,
            error: "Redirect with no Location header",
            failureType: "permanent",
          };
        }

        // Resolve relative redirect URLs against the current URL
        const nextUrl = new URL(location, currentUrl).href;

        if (attempt === MAX_REDIRECTS) {
          return {
            html: "",
            httpStatus: response.status,
            responseTimeMs: Date.now() - startTime,
            redirectChain,
            error: `Too many redirects (max ${MAX_REDIRECTS})`,
            failureType: "permanent",
          };
        }

        // SSRF-validate the redirect target
        const redirectSsrf = await validateUrl(nextUrl);
        if (!redirectSsrf.safe) {
          return {
            html: "",
            httpStatus: response.status,
            responseTimeMs: Date.now() - startTime,
            redirectChain,
            error: redirectSsrf.reason ?? "SSRF validation failed on redirect",
            failureType: "ssrf",
          };
        }

        redirectChain.push(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      // Success — read body and return
      const html = await response.text();
      return {
        html,
        httpStatus: response.status,
        responseTimeMs: Date.now() - startTime,
        redirectChain,
      };
    }

    // Should not be reachable, but TypeScript needs it
    return {
      html: "",
      httpStatus: lastStatus,
      responseTimeMs: Date.now() - startTime,
      redirectChain,
      error: `Too many redirects (max ${MAX_REDIRECTS})`,
      failureType: "permanent",
    };
  } catch (err) {
    return {
      html: "",
      httpStatus: 0,
      responseTimeMs: Date.now() - startTime,
      redirectChain,
      error: err instanceof Error ? err.message : "Unknown fetch error",
      failureType: "transient",
    };
  }
}
