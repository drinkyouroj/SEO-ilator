import { timingSafeEqual } from "node:crypto";

export function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const token = authHeader.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  if (token.length !== secret.length) return false;

  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(secret);

  return timingSafeEqual(a, b);
}
