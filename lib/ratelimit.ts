/** In-memory fixed-window limits. Dotty runs as one server process plus one worker. */
const LIMITS = {
  chat: { requests: 20, windowMs: 60_000 },
  webhook: { requests: 300, windowMs: 60_000 },
  connect: { requests: 20, windowMs: 60_000 },
} as const;

export type LimitName = keyof typeof LIMITS;
export interface LimitResult {
  ok: boolean;
  retryAfter: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(name: LimitName, key: string): Promise<LimitResult> {
  const { requests, windowMs } = LIMITS[name];
  const now = Date.now();
  const id = `${name}:${key}`;
  let entry = memory.get(id);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    memory.set(id, entry);
    if (memory.size > 10_000) {
      for (const [storedKey, value] of memory) {
        if (value.resetAt <= now) memory.delete(storedKey);
      }
    }
  }
  entry.count += 1;
  return {
    ok: entry.count <= requests,
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function tooMany(result: LimitResult, message = "Too many requests — slow down and try again shortly.") {
  return Response.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  );
}

export async function limitByIp(name: LimitName, request: Request) {
  const result = await rateLimit(name, clientIp(request));
  return result.ok ? null : tooMany(result);
}
