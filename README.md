# alfia-render-check-gate

Opens Alfia Gate pages in a real browser (Chromium, through Playwright) at **desktop (1440px)** and
**phone (390px)** sizes and reports problems visitors would see:

| Type | What is measured |
|---|---|
| `overflow` | Content wider than the screen (horizontal scrolling) |
| `contrast` | Text below WCAG contrast (4.5:1, or 3:1 for large text) on a solid background |
| `empty` | A Gate section (`[data-section]`) that renders empty or collapsed |
| `image` | An image that does not load |
| `overlap` | Text covering other text |
| `heading` | A heading cut inside words, or wrapping to about one word per line |
| `tap-target` | Links and buttons smaller than 32×32px on phones |
| `load` / `error` | The page did not load, or the check could not run |

The Alfia API calls it after the AI builds a Gate design and sends the problems back to the AI in a
repair round. If this service is unavailable, designs are saved without the check.

## API

`GET /health` → `{ "ok": true }`

`POST /check` with `Authorization: Bearer <RENDER_CHECK_TOKEN>`:

```json
{
  "pages": [{ "path": "/", "url": "https://gate.alfia.com.sa/g/orbit/preview" }],
  "cookie": { "name": "alfia_gate_orbit", "value": "<short-lived check session>" },
  "viewports": ["desktop", "mobile"]
}
```

Answer:

```json
{
  "pages": [
    { "path": "/", "issues": [
      { "viewport": "mobile", "type": "overflow", "section": "hero", "element": "div.hero-grid",
        "message": "div.hero-grid goes 140px beyond the 390px screen width, causing horizontal scrolling." }
    ] }
  ],
  "ms": 4210
}
```

## Server setup (Ubuntu 24.04)

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs git
sudo apt install -y fonts-noto-core fonts-noto-ui-core fonts-noto-color-emoji
sudo git clone https://github.com/alfiacapital/alfia-render-check-gate.git /opt/alfia-render-check-gate
sudo chown -R ubuntu:ubuntu /opt/alfia-render-check-gate
cd /opt/alfia-render-check-gate && npm ci --omit=dev
sudo npx playwright install-deps chromium && npx playwright install chromium
sudo cp .env.example /etc/alfia-render-check.env && sudo nano /etc/alfia-render-check.env
sudo cp deploy/alfia-render-check.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now alfia-render-check
curl http://127.0.0.1:8080/health
```

Update after a push:

```bash
cd /opt/alfia-render-check-gate && git pull && npm ci --omit=dev && sudo systemctl restart alfia-render-check
```

Logs: `journalctl -u alfia-render-check -f`

## Local development

```bash
npm install
npx playwright install chromium
cp .env.example .env   # set RENDER_CHECK_TOKEN
npm run dev
npm test
```
