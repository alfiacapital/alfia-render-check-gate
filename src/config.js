// All settings come from the environment (see .env.example).
const number = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: number(process.env.PORT, 8080, 1, 65535),
  token: process.env.RENDER_CHECK_TOKEN || "",
  // Pages rendered at the same time. Each open page uses about 200–500 MB of memory.
  concurrency: number(process.env.MAX_CONCURRENCY, 2, 1, 8),
  pageTimeoutMs: number(process.env.PAGE_TIMEOUT_MS, 30000, 5000, 120000),
  maxPages: number(process.env.MAX_PAGES, 24, 1, 60),
  // Comma-separated hosts the service may open, e.g. "gate.alfia.com.sa,dev-gate.alfia.com.sa".
  // Empty allows any host (only for local testing).
  allowedHosts: (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
};

export const viewports = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
};
