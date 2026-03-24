import * as dnsPromises from "node:dns/promises";
import type { UrlValidationResult } from "./types";

export function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return true;

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;

  return false;
}

export async function validateUrl(url: string): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { safe: false, reason: `Unsupported scheme: ${parsed.protocol}` };
  }

  let addresses: string[];
  try {
    addresses = await dnsPromises.resolve4(parsed.hostname);
  } catch (err) {
    return {
      safe: false,
      reason: `DNS resolution failed for ${parsed.hostname}: ${(err as Error).message}`,
    };
  }

  if (addresses.length === 0) {
    return { safe: false, reason: `DNS returned no addresses for ${parsed.hostname}` };
  }

  const ip = addresses[0];
  if (isPrivateIp(ip)) {
    return { safe: false, reason: `Resolved to private IP: ${ip}` };
  }

  return { safe: true, resolvedIp: ip };
}
