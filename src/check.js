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
 * Renders one page at one viewport and returns what the audit measured, plus a JPEG of the
 * page when asked (for the AI design review). A page that fails to load returns a single
 * "load" issue instead of throwing.
 *
 * @returns {Promise<{ issues: object[], screenshot: string|null }>}
 */
async function checkView({ url, cookie, screenshot }, name) {
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
    if (response?.error) return { issues: [{ type: "load", section: null, element: "page", message: `The page did not finish loading: ${String(response.error.message).split("\n")[0]}` }], screenshot: null };
    if (!response || response.status() >= 400) return { issues: [{ type: "load", section: null, element: "page", message: `The page answered with HTTP ${response?.status() ?? "no response"}.` }], screenshot: null };
    // Fonts change line breaks and widths, so measure only after they are ready.
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(250);
    const issues = await page.evaluate(audit, { mobile: viewport.isMobile });
    if (!screenshot) return { issues, screenshot: null };
    // The whole page, but capped so very long pages stay small enough for a vision model.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const image = await page.screenshot({
      type: "jpeg",
      quality: 60,
      fullPage: true,
      clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, viewport.isMobile ? config.maxShotMobile : config.maxShotDesktop) },
    });
    return { issues, screenshot: image.toString("base64") };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * @param {{ path: string, url: string }[]} pages
 * @param {{ name: string, value: string } | null} cookie
 * @param {string[]} views
 * @param {boolean} screenshots also return a base64 JPEG per page and viewport
 */
export async function checkPages(pages, cookie, views = ["desktop", "mobile"], screenshots = false) {
  const started = Date.now();
  const results = await Promise.all(
    pages.map(async ({ path, url }) => {
      const issues = [];
      const shots = {};
      for (const name of views) {
        const found = await slot(() => checkView({ url, cookie, screenshot: screenshots }, name)).catch((error) => ({
          issues: [{ type: "error", section: null, element: "page", message: `The check could not run: ${String(error.message).split("\n")[0]}` }],
          screenshot: null,
        }));
        issues.push(...found.issues.map((issue) => ({ viewport: name, ...issue })));
        if (found.screenshot) shots[name] = found.screenshot;
      }
      return screenshots ? { path, issues, screenshots: shots } : { path, issues };
    }),
  );
  return { pages: results, ms: Date.now() - started };
}
