import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkPages, closeBrowser } from "../src/check.js";

// A page with one of each problem, and a clean page.
const broken = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>
  body { margin: 0; font: 16px system-ui; }
  .wide { width: 900px; height: 40px; background: #eee; }
  .faint { color: #d9d9d9; background: #ffffff; }
  .tiny { display: inline-block; width: 18px; height: 18px; }
</style></head><body>
  <section data-section="hero"><h1>Welcome</h1><div class="wide">Too wide on phones</div></section>
  <section data-section="story"><p class="faint">Barely visible text on white</p></section>
  <section data-section="empty_block"></section>
  <section data-section="gallery"><img src="/missing.png" alt="" width="200" height="100"></section>
  <section data-section="footer"><a class="tiny" href="/x">x</a></section>
  <section data-section="squeezed" style="display:grid;grid-template-columns:auto 1fr"><h1 style="font-size:64px;overflow-wrap:anywhere;width:min-content">Two twelve-week programs a year</h1><p>Side text</p></section>
</body></html>`;
const clean = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0;font:16px system-ui">
  <section data-section="hero"><h1>All good</h1><p>Readable text.</p><a href="/x" style="display:inline-block;padding:12px 20px">Get started</a></section>
</body></html>`;

let server;
let origin;
let cookieSeen = null;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/missing.png") return res.writeHead(404).end();
    cookieSeen = req.headers.cookie || cookieSeen;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(req.url.startsWith("/clean") ? clean : broken);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await closeBrowser();
});

test("finds overflow, contrast, empty sections, broken images and small tap targets", async () => {
  const { pages } = await checkPages([{ path: "/", url: `${origin}/` }], { name: "alfia_gate_orbit", value: "check-token" });
  const issues = pages[0].issues;
  const has = (type, viewport, section) => issues.some((i) => i.type === type && i.viewport === viewport && (!section || i.section === section));
  assert.ok(has("overflow", "mobile", "hero"), "overflow on phones");
  assert.ok(!has("overflow", "desktop"), "no overflow on desktop");
  assert.ok(has("contrast", "desktop", "story"), "low contrast text");
  assert.ok(has("empty", "desktop", "empty_block"), "empty section");
  assert.ok(has("image", "desktop", "gallery"), "broken image");
  assert.ok(has("tap-target", "mobile", "footer"), "small link on phones");
  assert.ok(has("heading", "desktop", "squeezed"), "heading cut inside words");
  assert.match(cookieSeen || "", /alfia_gate_orbit=check-token/, "the preview cookie is sent");
});

test("a clean page has no issues", async () => {
  const { pages } = await checkPages([{ path: "/clean", url: `${origin}/clean` }], null);
  assert.deepEqual(pages[0].issues, []);
});

test("screenshots are returned as JPEG for each viewport when asked", async () => {
  const { pages } = await checkPages([{ path: "/clean", url: `${origin}/clean` }], null, ["desktop", "mobile"], true);
  for (const name of ["desktop", "mobile"]) {
    const image = Buffer.from(pages[0].screenshots[name], "base64");
    assert.equal(image[0], 0xff, `${name} is a JPEG`);
    assert.equal(image[1], 0xd8);
  }
});

test("a page that cannot load reports one load issue per viewport", async () => {
  const { pages } = await checkPages([{ path: "/down", url: "http://127.0.0.1:9/" }], null, ["desktop"]);
  assert.equal(pages[0].issues.length, 1);
  assert.equal(pages[0].issues[0].type, "load");
});
