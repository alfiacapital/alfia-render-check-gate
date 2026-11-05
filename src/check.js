import { chromium } from "playwright";
import { audit } from "./audit.js";
import { config, viewports } from "./config.js";

let browserPromise = null;

/** One shared Chromium; relaunched if it crashes. */
async function browser() {
  if (browserPromise) {
    const current = await browserPromise.catch(() => null);
    if (current?.isConnected()) return current;
  }
  browserPromise = chromium.launch({ args: ["--disable-dev-shm-usage"] });
  return browserPromise;
}

export async function closeBrowser() {
  const current = await browserPromise?.catch(() => null);
  browserPromise = null;
  await current?.close().catch(() => {});
}

/** A small semaphore so only `config.concurrency` pages render at once. */
let running = 0;
const waiting = [];
async function slot(work) {
  if (running >= config.concurrency) await new Promise((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/**
 * Renders one page at one viewport and returns what the audit measured.
 * A page that fails to load returns a single "load" issue instead of throwing.
 */
async function checkView({ url, cookie }, name) {
  const viewport = viewports[name];
  const context = await (await browser()).newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  try {
    if (cookie?.name && cookie?.value) {
      await context.addCookies([{ name: cookie.name, value: cookie.value, url: new URL(url).origin, httpOnly: true, sameSite: "Lax", secure: url.startsWith("https:") }]);
    }
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: config.pageTimeoutMs }).catch((error) => ({ error }));
    if (response?.error) return [{ type: "load", section: null, element: "page", message: `The page did not finish loading: ${String(response.error.message).split("\n")[0]}` }];
    if (!response || response.status() >= 400) return [{ type: "load", section: null, element: "page", message: `The page answered with HTTP ${response?.status() ?? "no response"}.` }];
    // Fonts change line breaks and widths, so measure only after they are ready.
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(250);
    return await page.evaluate(audit, { mobile: viewport.isMobile });
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * @param {{ path: string, url: string }[]} pages
 * @param {{ name: string, value: string } | null} cookie
 * @param {string[]} views
 */
export async function checkPages(pages, cookie, views = ["desktop", "mobile"]) {
  const started = Date.now();
  const results = await Promise.all(
    pages.map(async ({ path, url }) => {
      const issues = [];
      for (const name of views) {
        const found = await slot(() => checkView({ url, cookie }, name)).catch((error) => [
          { type: "error", section: null, element: "page", message: `The check could not run: ${String(error.message).split("\n")[0]}` },
        ]);
        issues.push(...found.map((issue) => ({ viewport: name, ...issue })));
      }
      return { path, issues };
    }),
  );
  return { pages: results, ms: Date.now() - started };
}
