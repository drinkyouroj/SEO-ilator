import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  windowMs: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  "POST:/api/articles": {
    maxTokens: 10,
    refillRate: 10 / 60, // 10 per minute
    windowMs: 60_000,
  },
  "POST:/api/analyze": {
    maxTokens: 5,
    refillRate: 5 / 3600, // 5 per hour
    windowMs: 3_600_000,
  },
  default: {
    maxTokens: 60,
    refillRate: 1, // 60 per minute
    windowMs: 60_000,
  },
};

// ---------------------------------------------------------------------------
// In-memory bucket store
// ---------------------------------------------------------------------------

const buckets = new Map<string, TokenBucket>();

// Periodic cleanup: remove buckets that haven't been touched in 10 minutes.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer !== null) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > STALE_THRESHOLD_MS) {
        buckets.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow the Node process to exit even if the timer is still running.
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function getConfig(method: string, path: string): RateLimitConfig {
  const key = `${method}:${path}`;
  return RATE_LIMIT_CONFIGS[key] ?? RATE_LIMIT_CONFIGS["default"];
}

function consumeToken(
  userId: string,
  method: string,
  path: string,
): { allowed: boolean; remaining: number; retryAfterSeconds: number; limit: number } {
  ensureCleanupTimer();

  const config = getConfig(method, path);
  const bucketKey = `${userId}:${method}:${path}`;
  const now = Date.now();

  let bucket = buckets.get(bucketKey);

  if (!bucket) {
    bucket = { tokens: config.maxTokens, lastRefill: now };
    buckets.set(bucketKey, bucket);
  }

  // Refill based on elapsed time
  const elapsedMs = now - bucket.lastRefill;
  const elapsedSeconds = elapsedMs / 1000;
  const tokensToAdd = elapsedSeconds * config.refillRate;
  bucket.tokens = Math.min(config.maxTokens, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterSeconds: 0,
      limit: config.maxTokens,
    };
  }

  // Not enough tokens — calculate retry-after
  const tokensNeeded = 1 - bucket.tokens;
  const retryAfterSeconds = Math.ceil(tokensNeeded / config.refillRate);

  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds,
    limit: config.maxTokens,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check rate limit for a given user + endpoint.
 * Returns `null` if the request is allowed, or a 429 NextResponse if denied.
 */
export function checkRateLimit(
  userId: string,
  method: string,
  path: string,
): NextResponse | null {
  const result = consumeToken(userId, method, path);

  if (result.allowed) {
    return null;
  }

  console.warn(`[rate-limit] Denied ${method} ${path} for user ${userId} (retry after ${result.retryAfterSeconds}s)`);

  return new NextResponse(
    JSON.stringify({
      error: "Too Many Requests",
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}

/**
 * Reset all buckets and the cleanup timer. Intended for testing only.
 */
export function resetBuckets(): void {
  buckets.clear();
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
