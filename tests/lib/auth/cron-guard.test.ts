import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyCronSecret } from "@/lib/auth/cron-guard";

describe("verifyCronSecret", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-secret-value");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns_false_without_authorization_header", () => {
    const request = new Request("https://example.com/api/cron/crawl", {
      headers: {},
    });
    const result = verifyCronSecret(request);
    expect(result).toBe(false);
  });

  it("returns_false_with_wrong_secret", () => {
    const request = new Request("https://example.com/api/cron/crawl", {
      headers: { authorization: "Bearer wrong-secret-value" },
    });
    const result = verifyCronSecret(request);
    expect(result).toBe(false);
  });

  it("returns_true_with_correct_secret", () => {
    const request = new Request("https://example.com/api/cron/crawl", {
      headers: { authorization: "Bearer test-secret-value" },
    });
    const result = verifyCronSecret(request);
    expect(result).toBe(true);
  });

  it("returns_false_when_cron_secret_env_is_unset", () => {
    vi.unstubAllEnvs();
    const request = new Request("https://example.com/api/cron/crawl", {
      headers: { authorization: "Bearer any-value" },
    });
    const result = verifyCronSecret(request);
    expect(result).toBe(false);
  });
});
