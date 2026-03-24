import { describe, it, expect, vi } from "vitest";
import { validateUrl, isPrivateIp } from "@/lib/ingestion/ssrf-guard";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
}));

import * as dns from "node:dns/promises";

describe("isPrivateIp", () => {
  it("rejects_loopback_127_0_0_1", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("rejects_loopback_range", () => {
    expect(isPrivateIp("127.255.255.255")).toBe(true);
  });

  it("rejects_10_x_private_range", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  it("rejects_172_16_31_private_range", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
  });

  it("allows_172_outside_private_range", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("rejects_192_168_private_range", () => {
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("192.168.255.255")).toBe(true);
  });

  it("rejects_link_local_169_254", () => {
    expect(isPrivateIp("169.254.1.1")).toBe(true);
  });

  it("rejects_zero_network", () => {
    expect(isPrivateIp("0.0.0.0")).toBe(true);
  });

  it("allows_public_ip", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
});

describe("validateUrl", () => {
  it("rejects_non_http_schemes", async () => {
    const result = await validateUrl("ftp://example.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("scheme");
  });

  it("rejects_file_scheme", async () => {
    const result = await validateUrl("file:///etc/passwd");
    expect(result.safe).toBe(false);
  });

  it("rejects_url_resolving_to_private_ip", async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(["127.0.0.1"]);

    const result = await validateUrl("https://evil.example.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("private");
  });

  it("allows_url_resolving_to_public_ip", async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(["93.184.216.34"]);

    const result = await validateUrl("https://example.com");
    expect(result.safe).toBe(true);
    expect(result.resolvedIp).toBe("93.184.216.34");
  });

  it("rejects_on_dns_resolution_failure", async () => {
    vi.mocked(dns.resolve4).mockRejectedValue(new Error("ENOTFOUND"));

    const result = await validateUrl("https://nonexistent.example.com");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("DNS");
  });
});
