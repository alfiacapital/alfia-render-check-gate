import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { checkPages, closeBrowser } from "./check.js";
import { config, viewports } from "./config.js";

if (config.token.length < 32) {
  console.error("RENDER_CHECK_TOKEN must be set to a secret of at least 32 characters.");
  process.exit(1);
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const authorized = (req) => {
  const given = Buffer.from((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(config.token);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Body must be JSON."), { status: 400 });
  }
}

/** Only http(s) pages on the allowed Gate hosts can be opened. */
function validate(body) {
  const pages = Array.isArray(body.pages) ? body.pages : [];
  if (!pages.length || pages.length > config.maxPages) throw Object.assign(new Error(`Send 1–${config.maxPages} pages.`), { status: 422 });
  const clean = pages.map((page) => {
    let url;
    try {
      url = new URL(String(page?.url || ""));
    } catch {
      throw Object.assign(new Error("Every page needs a valid url."), { status: 422 });
    }
    if (!["http:", "https:"].includes(url.protocol)) throw Object.assign(new Error("Only http and https pages can be checked."), { status: 422 });
    if (config.allowedHosts.length && !config.allowedHosts.includes(url.hostname.toLowerCase()))
      throw Object.assign(new Error(`Host ${url.hostname} is not allowed.`), { status: 422 });
    return { path: String(page.path || url.pathname).slice(0, 240), url: url.toString() };
  });
  const views = Array.isArray(body.viewports) && body.viewports.length ? body.viewports.filter((name) => name in viewports) : ["desktop", "mobile"];
  const cookie = body.cookie && typeof body.cookie.name === "string" && typeof body.cookie.value === "string" ? { name: body.cookie.name.slice(0, 120), value: body.cookie.value.slice(0, 512) } : null;
  return { pages: clean, views: views.length ? views : ["desktop", "mobile"], cookie, screenshots: body.screenshots === true };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
    if (req.method !== "POST" || req.url !== "/check") return json(res, 404, { message: "Not found." });
    if (!authorized(req)) return json(res, 401, { message: "Unauthorized." });
    const { pages, views, cookie, screenshots } = validate(await readBody(req));
    const result = await checkPages(pages, cookie, views, screenshots);
    console.log(`checked ${pages.length} page(s) × ${views.length} viewport(s)${screenshots ? " with screenshots" : ""} in ${result.ms}ms`);
    // One line per page: what was found, so the journal shows each design's problems.
    for (const page of result.pages) {
      const summary = page.issues.map((issue) => `${issue.viewport}·${issue.section ?? "page"}·${issue.type}`).join(", ");
      console.log(`  ${page.path}: ${page.issues.length ? summary : "no problems"}`);
    }
    return json(res, 200, result);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    return json(res, status, { message: status === 500 ? "The render check failed." : error.message });
  }
});

server.requestTimeout = 10 * 60 * 1000;
server.listen(config.port, config.host, () => console.log(`Alfia render check listening on ${config.host}:${config.port}`));

const shutdown = async () => {
  server.close();
  await closeBrowser();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
