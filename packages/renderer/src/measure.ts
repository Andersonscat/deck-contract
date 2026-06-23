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
