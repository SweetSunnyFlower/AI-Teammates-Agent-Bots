import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Simple rate limits (Phase 11). With UPSTASH_REDIS_REST_URL / _TOKEN set they're shared across
 * every server instance (Upstash Redis, sliding window). Without them each instance counts in
 * memory — fine for local dev, best-effort in production.
 */
const LIMITS = {
  /** Web chat: messages per signed-in user. Each one is a model call. */
  chat: { requests: 20, window: "1 m" },
  /** Telegram / Slack / GitHub webhooks, per IP (signatures are checked too). */
  webhook: { requests: 300, window: "1 m" },
  /** Connect flows (GitHub / Slack install and callbacks), per IP. */
  connect: { requests: 20, window: "1 m" },
} satisfies Record<string, { requests: number; window: Duration }>;

export type LimitName = keyof typeof LIMITS;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const limiters = new Map<LimitName, Ratelimit>();
function limiter(name: LimitName) {
  let l = limiters.get(name);
  if (!l && redis) {
    const { requests, window } = LIMITS[name];
    // timeout: if Redis is slow or down, let the request through rather than break the app.
    l = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(requests, window),
      prefix: `dotty:rl:${name}`,
      ephemeralCache: new Map(),
      timeout: 1000,
    });
    limiters.set(name, l);
  }
  return l;
}

// In-memory fallback: fixed window per key.
const memory = new Map<string, { count: number; resetAt: number }>();
const windowMs = (w: Duration) => {
  const [n, unit] = w.split(" ") as [string, string];
  return (
    Number(n) *
    ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 60_000)
  );
};

export interface LimitResult {
  ok: boolean;
  /** Seconds until the caller may try again (when blocked). */
  retryAfter: number;
}

export async function rateLimit(
  name: LimitName,
  key: string,
): Promise<LimitResult> {
  const l = limiter(name);
  if (l) {
    try {
      const r = await l.limit(key);
      return {
        ok: r.success,
        retryAfter: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)),
      };
    } catch (error) {
      console.error(
        "[ratelimit] Redis failed; allowing",
        error instanceof Error ? error.message : error,
      );
      return { ok: true, retryAfter: 0 };
    }
  }
  const { requests, window } = LIMITS[name];
  const now = Date.now();
  const id = `${name}:${key}`;
  let entry = memory.get(id);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs(window) };
    memory.set(id, entry);
    if (memory.size > 10_000)
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }
  entry.count += 1;
  return {
    ok: entry.count <= requests,
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

/** The caller's IP (Vercel / proxies set x-forwarded-for; the first entry is the client). */
export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** A 429 response with Retry-After. */
export function tooMany(
  result: LimitResult,
  message = "Too many requests — slow down and try again shortly.",
) {
  return Response.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  );
}

/** Rate-limits a webhook or connect route by IP; returns a 429 response when blocked. */
export async function limitByIp(name: LimitName, request: Request) {
  const r = await rateLimit(name, clientIp(request));
  return r.ok ? null : tooMany(r);
}
