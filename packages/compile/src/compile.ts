import type { Deck, DeckNode, Frame, Theme } from "@deck/contract";

/**
 * compileHtml is PURE and side-effect-free (load-bearing, decision #3): no I/O,
 * no Date.now(), no Math.random(), no font loading. Same deck in -> byte-identical
 * HTML out, always. That is the precondition for a converging render-and-check loop
 * and for content-hash caching. Anything non-deterministic must happen in the ops
 * layer (id minting) BEFORE compile runs.
 */

export interface CompiledHtml {
  html: string;
  css: string;
}

const NS_ORDER = ["color", "font", "type", "space", "radius"] as const;

/** Map a node style prop to one or more CSS declarations. */
const STYLE_PROP_CSS: Record<string, string> = {
  color: "color",
  font: "font-family",
  size: "font-size",
  marker: "--marker-color",
  valueColor: "color",
  valueFont: "font-family",
  valueSize: "font-size",
  labelColor: "--label-color",
  labelSize: "--label-size",
  captionColor: "--caption-color",
  captionSize: "--caption-size",
  radius: "border-radius",
  background: "background",
  bar: "--bar-color",
  headColor: "--head-color",
  lineColor: "--line-color",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `token://color/accent` -> `var(--color-accent)`. Deterministic. */
function tokenToVar(ref: string): string {
  const m = /^token:\/\/([a-z][a-z0-9]*)\/([A-Za-z0-9][A-Za-z0-9-]*)$/.exec(ref);
  if (!m) return ref;
  return `var(--${m[1]}-${m[2]})`;
}

function themeToCssVars(theme: Theme): string {
  const lines: string[] = [];
  for (const ns of NS_ORDER) {
    const group = (theme as Record<string, Record<string, string> | undefined>)[ns];
    if (!group) continue;
    for (const key of Object.keys(group).sort()) {
      lines.push(`  --${ns}-${key}: ${group[key]};`);
    }
  }
  return lines.join("\n");
}

function styleToCss(style: Record<string, string> | undefined): string {
  if (!style) return "";
  const out: string[] = [];
  for (const prop of Object.keys(style).sort()) {
    const cssProp = STYLE_PROP_CSS[prop] ?? `--${prop}`;
    out.push(`${cssProp}:${tokenToVar(style[prop]!)}`);
  }
  return out.join(";");
}

function layoutToCss(node: DeckNode): string {
  const l = node.layout;
  const out: string[] = [];
  const isContainer = Array.isArray(node.children);
  if (isContainer) {
    out.push("display:flex");
    out.push(`flex-direction:${l?.direction === "row" ? "row" : "column"}`);
  }
  if (l?.gap) out.push(`gap:${tokenToVar(l.gap)}`);
  if (l?.padding) out.push(`padding:${tokenToVar(l.padding)}`);
  if (l?.align) {
    const map = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
    out.push(`align-items:${map[l.align]}`);
  }
  if (l?.justify) {
    const map = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };
    out.push(`justify-content:${map[l.justify]}`);
  }
  if (l?.sizing?.width === "fill") out.push("flex:1 1 0%", "min-width:0");
  if (l?.sizing?.height === "fill") out.push("align-self:stretch");
  return out.join(";");
}

/** Canonical number format so compileHtml stays byte-identical (and quantizes to a grid). */
function fmt(n: number): string {
  return n.toFixed(3).replace(/\.?0+$/, "");
}

/** A framed node is taken out of flow and positioned absolutely on the slide (in %). */
function frameToCss(f: Frame): string {
  const out = [`position:absolute`, `left:${fmt(f.x)}%`, `top:${fmt(f.y)}%`];
  if (f.w !== undefined) out.push(`width:${fmt(f.w)}%`);
  if (f.h !== undefined) out.push(`height:${fmt(f.h)}%`);
  if (f.rotation) out.push(`transform:rotate(${fmt(f.rotation)}deg)`);
  if (f.z !== undefined) out.push(`z-index:${f.z}`);
  return out.join(";");
}

function attrs(node: DeckNode): string {
  const parts = [];
  if (node.frame) parts.push(frameToCss(node.frame));
  parts.push(layoutToCss(node), styleToCss(node.style));
  if (node.textAlign) parts.push(`text-align:${node.textAlign}`);
  const style = parts.filter(Boolean).join(";");
  const styleAttr = style ? ` style="${esc(style)}"` : "";
  const roleAttr = node.role ? ` data-role="${esc(node.role)}"` : "";
  // data-type/data-role let an interactive viewer know what was clicked.
  return ` data-cid="${esc(node.id)}" data-type="${esc(node.type)}"${roleAttr}${styleAttr}`;
}

function renderLeaf(node: DeckNode): string {
  const c = node.content ?? {};
  switch (node.type) {
    case "title":
    case "heading":
      return `<h1${attrs(node)}>${esc(c.text ?? "")}</h1>`;
    case "bullet-list":
      return `<ul${attrs(node)}>${(c.items ?? [])
        .map((it) => `<li>${esc(it)}</li>`)
        .join("")}</ul>`;
    case "stat-callout":
      return `<div${attrs(node)}><div class="stat-value">${esc(
        c.value ?? "",
      )}</div><div class="stat-label">${esc(c.label ?? "")}${
        c.delta ? ` <span class="stat-delta">${esc(c.delta)}</span>` : ""
      }</div></div>`;
    case "image-caption":
      return `<figure${attrs(node)}><img src="${esc(c.src ?? "")}" alt="${esc(
        c.alt ?? "",
      )}"/>${c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : ""}</figure>`;
    case "bar-chart": {
      const data = c.data ?? [];
      // Bar height in px (layout-independent, so the chart reads the same in flow or in
      // a frame). Scaled to the largest value; pure -> byte-identical output.
      const max = data.reduce((m, d) => Math.max(m, d.value), 0) || 1;
      const cols = data
        .map(
          (d) =>
            `<div class="bc-col"><div class="bc-track"><div class="bc-bar" style="height:${fmt(
              (d.value / max) * 240,
            )}px"></div></div><div class="bc-val">${esc(String(d.value))}</div><div class="bc-cat">${esc(
              d.label,
            )}</div></div>`,
        )
        .join("");
      return `<div${attrs(node)}><div class="bar-chart">${cols}</div></div>`;
    }
    case "table": {
      const head = (c.columns ?? []).length
        ? `<thead><tr>${(c.columns ?? []).map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`
        : "";
      const rows = (c.rows ?? [])
        .map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
        .join("");
      return `<div${attrs(node)}><table class="dc-table">${head}<tbody>${rows}</tbody></table></div>`;
    }
    case "bar":
      return renderBar(node);
    default:
      return `<div${attrs(node)}>${esc(c.text ?? "")}</div>`;
  }
}

/**
 * A single bar = one addressable component of a decomposed bar-chart. Height comes from
 * content.barValue (0..100% of the chart box); the fill is the node's own `color` token
 * (rendered as background) so the standard recolor/AI path targets ONE bar by its id.
 */
function renderBar(node: DeckNode): string {
  const c = node.content ?? {};
  const v = Math.max(0, Math.min(100, Number(c.barValue ?? 0)));
  const fill = node.style?.color ?? node.style?.background;
  const parts: string[] = [];
  if (node.frame) parts.push(frameToCss(node.frame));
  parts.push(
    "flex:1 1 0%",
    "min-width:0",
    "align-self:flex-end",
    `height:${fmt(v)}%`,
    "border-radius:7px 7px 0 0",
    `background:${fill ? tokenToVar(fill) : "var(--color-accent)"}`,
  );
  const roleAttr = node.role ? ` data-role="${esc(node.role)}"` : "";
  return `<div data-cid="${esc(node.id)}" data-type="bar"${roleAttr} style="${esc(parts.join(";"))}"></div>`;
}

function renderNode(node: DeckNode): string {
  if (Array.isArray(node.children)) {
    return `<div${attrs(node)}>${node.children.map(renderNode).join("")}</div>`;
  }
  return renderLeaf(node);
}

function renderSlide(slide: DeckNode, canvas: { width: number; height: number }): string {
  const inner = (slide.children ?? []).map(renderNode).join("");
  const box = `width:${canvas.width}px;height:${canvas.height}px;${layoutToCss(slide)};${styleToCss(
    slide.style,
  )}`;
  return `<section class="slide" data-cid="${esc(slide.id)}" data-type="slide" style="${esc(box)}">${inner}</section>`;
}

const BASE_CSS = `*{margin:0;box-sizing:border-box;animation:none!important;transition:none!important}
html,body{padding:0}
.slide{position:relative;overflow:hidden;font-family:var(--font-body);color:var(--color-text)}
.slide img{max-width:100%;display:block}
ul{list-style:disc;padding-left:1.2em}
ul li::marker{color:var(--marker-color)}
.bar-chart{display:flex;align-items:flex-end;gap:18px;width:100%}
.bc-col{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1}
.bc-track{height:240px;width:100%;display:flex;align-items:flex-end;justify-content:center}
.bc-bar{width:62%;max-width:72px;background:var(--bar-color,var(--color-accent));border-radius:8px 8px 0 0}
.bc-val{font-size:15px;font-weight:700}
.bc-cat{font-size:14px;color:var(--label-color,var(--color-muted))}
.dc-table{border-collapse:collapse;width:100%;font-size:18px}
.dc-table th,.dc-table td{text-align:left;padding:11px 18px;border-bottom:1px solid var(--line-color,var(--color-surface))}
.dc-table th{color:var(--head-color,var(--color-accent));font-family:var(--font-heading);font-weight:700}`;

/** Per-slide fragments + shared CSS, for hosts that frame each slide separately (the viewer). */
export function compileSlides(deck: Deck): { css: string; slides: { id: string; html: string }[] } {
  const vars = themeToCssVars(deck.theme);
  const css = `:root{\n${vars}\n}\n${BASE_CSS}`;
  const slides = deck.slides.map((s) => ({ id: s.id, html: renderSlide(s, deck.canvas) }));
  return { css, slides };
}

export function compileHtml(deck: Deck): CompiledHtml {
  const vars = themeToCssVars(deck.theme);
  const css = `:root{\n${vars}\n}\n${BASE_CSS}`;
  const slides = deck.slides.map((s) => renderSlide(s, deck.canvas)).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(deck.title ?? deck.id)}</title>
<style>
${css}
</style>
</head>
<body>
${slides}
</body>
</html>`;
  return { html, css };
}
