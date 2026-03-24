import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkRateLimit,
  RATE_LIMIT_CONFIGS,
  resetBuckets,
} from "@/lib/rate-limit";

describe("rate-limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBuckets();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetBuckets();
  });

  it("allows_requests_within_limit", () => {
    const config = RATE_LIMIT_CONFIGS["default"];

    for (let i = 0; i < config.maxTokens; i++) {
      const res = checkRateLimit("user-1", "GET", "/api/something");
      expect(res).toBeNull();
    }
  });

  it("rejects_requests_exceeding_limit", () => {
    const config = RATE_LIMIT_CONFIGS["default"];

    // Exhaust all tokens
    for (let i = 0; i < config.maxTokens; i++) {
      checkRateLimit("user-1", "GET", "/api/something");
    }

    // Next request should be rejected
    const res = checkRateLimit("user-1", "GET", "/api/something");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("returns_429_response_with_retry_after_header", async () => {
    const config = RATE_LIMIT_CONFIGS["POST:/api/articles"];

    // Exhaust all tokens (10)
    for (let i = 0; i < config.maxTokens; i++) {
      checkRateLimit("user-1", "POST", "/api/articles");
    }

    const res = checkRateLimit("user-1", "POST", "/api/articles");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBeTruthy();
    expect(res!.headers.get("X-RateLimit-Limit")).toBe(
      String(config.maxTokens),
    );
    expect(res!.headers.get("X-RateLimit-Remaining")).toBe("0");

    const body = await res!.json();
    expect(body.error).toBe("Too Many Requests");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("refills_tokens_over_time", () => {
    const config = RATE_LIMIT_CONFIGS["POST:/api/articles"];

    // Exhaust all tokens
    for (let i = 0; i < config.maxTokens; i++) {
      checkRateLimit("user-1", "POST", "/api/articles");
    }

    // Should be rejected now
    expect(checkRateLimit("user-1", "POST", "/api/articles")).not.toBeNull();

    // Advance time by 6 seconds — refillRate is 10/60 ≈ 0.1667/s, so 6s ≈ 1 token
    vi.advanceTimersByTime(6_100);

    // Should be allowed again (1 token refilled)
    const res = checkRateLimit("user-1", "POST", "/api/articles");
    expect(res).toBeNull();
  });

  it("uses_correct_config_for_endpoint", () => {
    // POST:/api/articles has maxTokens: 10
    // Consume 10 tokens — should all succeed
    for (let i = 0; i < 10; i++) {
      const res = checkRateLimit("user-1", "POST", "/api/articles");
      expect(res).toBeNull();
    }

    // 11th should fail
    const res = checkRateLimit("user-1", "POST", "/api/articles");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("uses_default_config_for_unknown_endpoints", () => {
    // Default has maxTokens: 60
    for (let i = 0; i < 60; i++) {
      const res = checkRateLimit("user-1", "GET", "/api/unknown");
      expect(res).toBeNull();
    }

    // 61st should fail
    const res = checkRateLimit("user-1", "GET", "/api/unknown");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("isolates_buckets_per_user", () => {
    const config = RATE_LIMIT_CONFIGS["POST:/api/articles"];

    // Exhaust user-1's tokens
    for (let i = 0; i < config.maxTokens; i++) {
      checkRateLimit("user-1", "POST", "/api/articles");
    }

    // user-1 should be rejected
    expect(checkRateLimit("user-1", "POST", "/api/articles")).not.toBeNull();

    // user-2 should still be allowed
    expect(checkRateLimit("user-2", "POST", "/api/articles")).toBeNull();
  });
});
