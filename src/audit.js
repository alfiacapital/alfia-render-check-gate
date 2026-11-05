/**
 * Runs inside the rendered page (passed to page.evaluate, so it must be self-contained).
 * Measures problems a visitor would see and returns them with the Gate section they belong to.
 *
 * @param {{ mobile: boolean }} options
 * @returns {{ type: string, section: string|null, element: string, message: string }[]}
 */
export function audit({ mobile }) {
  const issues = [];
  const viewportWidth = document.documentElement.clientWidth;
  const all = [...document.body.querySelectorAll("*")];

  const sectionOf = (el) => {
    const section = el.closest("[data-section]");
    if (section) return section.getAttribute("data-section");
    return el.closest("section[id]")?.id || null;
  };
  const describe = (el) => {
    const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return el.tagName.toLowerCase() + (classes.length ? `.${classes.join(".")}` : "");
  };
  const isVisible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const sampleText = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
  const add = (type, el, message) => issues.push({ type, section: el ? sectionOf(el) : null, element: el ? describe(el) : "page", message });

  // ---------- Horizontal overflow (content wider than the screen) ----------
  if (document.documentElement.scrollWidth > viewportWidth + 1) {
    const clippedByAncestor = (el) => {
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (overflow !== "visible") {
          const rect = parent.getBoundingClientRect();
          if (rect.right <= viewportWidth + 1 && rect.left >= -1) return true;
        }
      }
      return false;
    };
    const offenders = all.filter((el) => {
      if (!isVisible(el)) return false;
      const rect = el.getBoundingClientRect();
      return (rect.right > viewportWidth + 1 || rect.left < -1) && !clippedByAncestor(el);
    });
    // The innermost elements are the ones to fix; their parents only grow because of them.
    const innermost = offenders.filter((el) => !offenders.some((other) => other !== el && el.contains(other)));
    for (const el of innermost.slice(0, 4)) {
      const rect = el.getBoundingClientRect();
      const extra = Math.round(Math.max(rect.right - viewportWidth, -rect.left));
      add("overflow", el, `${describe(el)} goes ${extra}px beyond the ${viewportWidth}px screen width, causing horizontal scrolling.`);
    }
  }

  // ---------- Text contrast ----------
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const [r, g, b, a = "1"] = match[1].split(/[\s,/]+/).filter(Boolean);
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  };
  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const channel = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  // The solid colour behind an element, or null when an image or gradient makes it unknowable.
  const backgroundOf = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const color = parse(style.backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a >= 1) break;
      }
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) result = blend(layer, result);
    return result;
  };
  const textElements = all.filter(
    (el) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 1) && isVisible(el),
  );
  let contrastIssues = 0;
  for (const el of textElements) {
    if (contrastIssues >= 6) break;
    const style = getComputedStyle(el);
    const background = backgroundOf(el);
    const text = parse(style.color);
    if (!background || !text) continue;
    const foreground = blend(text, background);
    const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
    const ratio = (light + 0.05) / (dark + 0.05);
    const size = Number.parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      contrastIssues += 1;
      add("contrast", el, `Text "${sampleText(el)}" has a contrast of ${ratio.toFixed(2)}:1 (needs ${large ? "3" : "4.5"}:1); it is hard to read.`);
    }
  }

  // ---------- Empty or collapsed sections ----------
  for (const section of document.querySelectorAll("[data-section]")) {
    const rect = section.getBoundingClientRect();
    const style = getComputedStyle(section);
    if (style.display === "none") continue;
    const hasMedia = section.querySelector("img, svg, video, picture, canvas, iframe");
    const hasText = (section.innerText || "").trim().length > 0;
    if (rect.height < 8 || (!hasText && !hasMedia && style.backgroundImage === "none")) {
      add("empty", section, `Section "${section.getAttribute("data-section")}" renders empty (${Math.round(rect.height)}px tall, no visible content).`);
    }
  }

  // ---------- Broken images ----------
  for (const img of document.querySelectorAll("img")) {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) {
      add("image", img, `Image ${img.getAttribute("src").slice(0, 120)} did not load.`);
    }
  }

  // ---------- Text covering other text ----------
  const boxes = textElements.slice(0, 400).map((el) => ({ el, rect: el.getBoundingClientRect() }));
  let overlapIssues = 0;
  for (let i = 0; i < boxes.length && overlapIssues < 4; i++) {
    for (let j = i + 1; j < boxes.length && overlapIssues < 4; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (width <= 0 || height <= 0) continue;
      const smaller = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
      if (smaller > 0 && (width * height) / smaller > 0.35) {
        overlapIssues += 1;
        add("overlap", a.el, `Text "${sampleText(a.el)}" overlaps "${sampleText(b.el)}" (${describe(b.el)}).`);
      }
    }
  }

  // ---------- Tap targets on phones ----------
  if (mobile) {
    const small = new Map();
    for (const el of document.querySelectorAll("a[href], button, [role='button'], input, select, textarea")) {
      if (!isVisible(el) || el.closest("p, li p")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 32 || rect.height < 32) {
        const key = sectionOf(el) || "page";
        if (!small.has(key)) small.set(key, el);
      }
    }
    for (const el of [...small.values()].slice(0, 4)) {
      const rect = el.getBoundingClientRect();
      add("tap-target", el, `${describe(el)} is ${Math.round(rect.width)}×${Math.round(rect.height)}px; buttons and links should be at least 32×32px on phones.`);
    }
  }

  return issues;
}
