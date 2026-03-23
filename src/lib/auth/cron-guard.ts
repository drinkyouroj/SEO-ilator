import { timingSafeEqual } from "node:crypto";

export function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron-guard] CRON_SECRET environment variable is not set. All cron requests will be rejected."
    );
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  if (token.length !== secret.length) return false;

  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(secret);

  return timingSafeEqual(a, b);
}
