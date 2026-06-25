/**
 * Browser-side measurement. This runs INSIDE the page, so it is kept as a plain
 * source string and injected verbatim — never passed as a compiled function. That
 * makes it immune to bundler transforms (esbuild's keepNames wraps inner functions
 * in a `__name` helper that does not exist in the page), so it behaves identically
 * under vitest, tsx, and the eventual production build.
 *
 * It measures the two things only a real layout engine can tell us:
 *   - OVERFLOW: a slide's content exceeds its fixed frame (clipped by overflow:hidden)
 *   - OUT_OF_BOUNDS: an element extends past the slide edges
 * Font drift is NOT measured — it is structurally impossible (token-only style).
 */
export interface RawIssue {
  code: "OVERFLOW" | "OUT_OF_BOUNDS";
  nodeId: string;
  slideId: string;
  axis?: "x" | "y";
  overflowPx: number;
}

/**
 * A NEUTRAL ground-truth fact about one rendered text node — never a verdict. The harness
 * reports the resolved foreground/background and the WCAG contrast ratio as numbers; whether
 * that is "good" is decided only against the USER's stated goal, never a system rule. This is
 * the un-fakeable observation a cheap model self-corrects against (and that makes "done" a
 * measured fact, not the model's word).
 */
export interface Observation {
  nodeId: string;
  slideId: string;
  type: string;
  text: string;
  fg: string;
  bg: string;
  /** WCAG contrast ratio of fg vs the effective background, 1..21. */
  contrast: number;
  bounds: { x: number; y: number; w: number; h: number };
}

/** Source of `() => Observation[]`. Runs in the page; uses getComputedStyle, so it sees the
 * REAL resolved colours after token -> CSS var resolution. Reports facts only, no verdicts. */
export const OBSERVE_SOURCE = `(function () {
  var TEXT = { title:1, heading:1, subtitle:1, text:1, "bullet-list":1, "bar-value":1, "bar-label":1, "stat-callout":1, quote:1 };
  function parseRGB(s){ var m = /rgba?\\(([^)]+)\\)/.exec(s || ""); if(!m) return null; var p = m[1].split(",").map(function(x){ return parseFloat(x); }); return { r:p[0], g:p[1], b:p[2], a: p.length > 3 ? p[3] : 1 }; }
  function lum(c){ function f(v){ v = v/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); } return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); }
  function contrast(fg, bg){ var L1 = lum(fg), L2 = lum(bg), hi = Math.max(L1,L2), lo = Math.min(L1,L2); return Math.round(((hi+0.05)/(lo+0.05)) * 100) / 100; }
  function hex(c){ function h(n){ n = Math.max(0, Math.min(255, Math.round(n))).toString(16); return n.length < 2 ? "0"+n : n; } return "#"+h(c.r)+h(c.g)+h(c.b); }
  function effBg(el){ var n = el; while(n && n !== document.documentElement){ var c = parseRGB(getComputedStyle(n).backgroundColor); if(c && c.a > 0) return c; n = n.parentElement; } var b = parseRGB(getComputedStyle(document.body).backgroundColor); if(b && b.a > 0) return b; return { r:255, g:255, b:255, a:1 }; }
  var out = [];
  var sections = Array.prototype.slice.call(document.querySelectorAll("section.slide"));
  for (var s = 0; s < sections.length; s++) {
    var section = sections[s];
    var slideId = section.getAttribute("data-cid") || "";
    var sr = section.getBoundingClientRect();
    var els = Array.prototype.slice.call(section.querySelectorAll("[data-cid]"));
    for (var e = 0; e < els.length; e++) {
      var el = els[e];
      var t = el.getAttribute("data-type") || "";
      if (!TEXT[t]) continue;
      var txt = (el.textContent || "").replace(/\\s+/g, " ").trim();
      if (!txt) continue;
      var fg = parseRGB(getComputedStyle(el).color);
      if (!fg) continue;
      var bg = effBg(el);
      var r = el.getBoundingClientRect();
      out.push({
        nodeId: el.getAttribute("data-cid") || "",
        slideId: slideId,
        type: t,
        text: txt.slice(0, 40),
        fg: hex(fg),
        bg: hex(bg),
        contrast: contrast(fg, bg),
        bounds: { x: Math.round(r.left - sr.left), y: Math.round(r.top - sr.top), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
  }
  return out;
})`;

/** Source of `(eps) => RawIssue[]`. `eps` absorbs sub-pixel rounding noise. */
export const MEASURE_SOURCE = `(function (eps) {
  var issues = [];
  function round(n) { return Math.round(n * 10) / 10; }
  var sections = Array.prototype.slice.call(document.querySelectorAll("section.slide"));
  for (var s = 0; s < sections.length; s++) {
    var section = sections[s];
    var slideId = section.getAttribute("data-cid") || "";
    var srect = section.getBoundingClientRect();

    var oy = section.scrollHeight - section.clientHeight;
    var ox = section.scrollWidth - section.clientWidth;
    if (oy > eps) issues.push({ code: "OVERFLOW", nodeId: slideId, slideId: slideId, axis: "y", overflowPx: round(oy) });
    if (ox > eps) issues.push({ code: "OVERFLOW", nodeId: slideId, slideId: slideId, axis: "x", overflowPx: round(ox) });

    var els = Array.prototype.slice.call(section.querySelectorAll("[data-cid]"));
    for (var e = 0; e < els.length; e++) {
      var el = els[e];
      var cid = el.getAttribute("data-cid") || "";
      if (cid === slideId) continue;
      var r = el.getBoundingClientRect();
      var over = Math.max(r.bottom - srect.bottom, r.right - srect.right, srect.top - r.top, srect.left - r.left);
      if (over > eps) issues.push({ code: "OUT_OF_BOUNDS", nodeId: cid, slideId: slideId, overflowPx: round(over) });
    }
  }
  return issues;
})`;
