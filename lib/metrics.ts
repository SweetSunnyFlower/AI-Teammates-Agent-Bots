import "server-only";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

function createMetrics() {
  const register = new Registry();
  collectDefaultMetrics({ register, prefix: "dotty_" });

  const httpRequests = new Counter({
    name: "dotty_http_requests_total",
    help: "Total HTTP requests handled by Dotty.",
    labelNames: ["method", "route", "status"],
    registers: [register],
  });

  const httpDuration = new Histogram({
    name: "dotty_http_request_duration_seconds",
    help: "HTTP request duration in seconds.",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });

  return { register, httpRequests, httpDuration };
}

type Metrics = ReturnType<typeof createMetrics>;

const globalForMetrics = globalThis as unknown as { dottyMetrics?: Metrics };
export const metrics = globalForMetrics.dottyMetrics ?? createMetrics();
globalForMetrics.dottyMetrics = metrics;

export function observeHttpRequest(
  request: { method: string; nextUrl: { pathname: string } },
  status: number,
  durationMs: number,
) {
  const route = request.nextUrl.pathname.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ":id",
  );
  const labels = {
    method: request.method,
    route,
    status: String(status),
  };
  metrics.httpRequests.inc(labels);
  metrics.httpDuration.observe(labels, Math.max(0, durationMs) / 1000);
}
