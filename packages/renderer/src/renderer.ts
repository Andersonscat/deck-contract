import { chromium, type Browser } from "playwright";
import { compileHtml } from "@deck/compile";
import { IssueCode, type Deck, type Issue } from "@deck/contract";
import { MEASURE_SOURCE, OBSERVE_SOURCE, type RawIssue, type Observation } from "./measure.js";

/**
 * LocalChromiumRenderer — the imperative shell around the pure core. It owns the only
 * side effects in the pipeline (a headless browser). One warm browser per instance,
 * a short-lived context per render (concurrency 1 for the MVP). Determinism is
 * engineered in: external network blocked, fonts awaited, animations disabled, a
 * sub-pixel epsilon on every measurement.
 *
 * The interface (render/export/close) is the seam: swapping in a pooled or remote
 * renderer later does not touch the core.
 */
export interface RenderedSlide {
  slideId: string;
  png: Buffer;
  width: number;
  height: number;
}

export interface RenderResult {
  slides: RenderedSlide[];
  issues: Issue[];
  /** Neutral per-text-node facts (resolved colours + WCAG contrast + bounds). */
  observations: Observation[];
}

export interface RenderOptions {
  /** Retina by default for crisp previews. */
  deviceScaleFactor?: number;
  /** Sub-pixel tolerance for overflow detection. */
  epsilonPx?: number;
}

const EPS_DEFAULT = 0.5;

function toIssue(raw: RawIssue): Issue {
  const code = raw.code === "OVERFLOW" ? IssueCode.OVERFLOW : IssueCode.OUT_OF_BOUNDS;
  const detail =
    raw.code === "OVERFLOW"
      ? `slide content exceeds its frame by ${raw.overflowPx}px on the ${raw.axis} axis`
      : `element extends ${raw.overflowPx}px past the slide edge`;
  return {
    code,
    nodeId: raw.nodeId,
    slideId: raw.slideId,
    severity: "error",
    detail,
    measured: raw.axis ? { overflowPx: raw.overflowPx, axis: raw.axis } : { overflowPx: raw.overflowPx },
    suggestedOps:
      raw.code === "OVERFLOW"
        ? ["shorten text", "drop to a smaller type token", "split the slide"]
        : ["move the element into a fitting container", "reduce its size"],
  };
}

export class LocalChromiumRenderer {
  private browserP?: Promise<Browser>;

  private browser(): Promise<Browser> {
    return (this.browserP ??= chromium.launch({
      headless: true,
      args: ["--font-render-hinting=none", "--force-color-profile=srgb", "--hide-scrollbars"],
    }));
  }

  async render(deck: Deck, opts: RenderOptions = {}): Promise<RenderResult> {
    const dsf = opts.deviceScaleFactor ?? 2;
    const eps = opts.epsilonPx ?? EPS_DEFAULT;

    const browser = await this.browser();
    const context = await browser.newContext({
      viewport: { width: deck.canvas.width, height: deck.canvas.height },
      deviceScaleFactor: dsf,
    });
    // Block all external resources -> deterministic, offline, no FOUT from CDN fonts.
    await context.route("**", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("about:")) route.continue();
      else route.abort();
    });

    const page = await context.newPage();
    try {
      const { html } = compileHtml(deck);
      await page.setContent(html, { waitUntil: "load" });
      // Wait for fonts + two animation frames so layout has fully settled before measuring.
      await page.evaluate(async () => {
        await (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready;
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
      });

      // Inject the measurement source verbatim (see measure.ts) — bundler-proof.
      const raw = (await page.evaluate(`(${MEASURE_SOURCE})(${eps})`)) as RawIssue[];
      const issues = raw.map(toIssue);
      // Neutral perception facts (resolved colours + WCAG contrast) — the un-fakeable signal.
      const observations = (await page.evaluate(`(${OBSERVE_SOURCE})()`)) as Observation[];

      const slides: RenderedSlide[] = [];
      for (const slide of deck.slides) {
        const el = await page.$(`[data-cid="${slide.id}"]`);
        if (!el) continue;
        const png = await el.screenshot({ type: "png" });
        slides.push({ slideId: slide.id, png, width: deck.canvas.width, height: deck.canvas.height });
      }
      return { slides, issues, observations };
    } finally {
      await context.close();
    }
  }

  /** Export the whole deck to a single PDF, one slide per page, vector (live) text. */
  async exportPdf(deck: Deck): Promise<Buffer> {
    const browser = await this.browser();
    const context = await browser.newContext();
    await context.route("**", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("about:")) route.continue();
      else route.abort();
    });
    const page = await context.newPage();
    try {
      const { html } = compileHtml(deck);
      await page.setContent(html, { waitUntil: "load" });
      await page.addStyleTag({
        content: `@page{size:${deck.canvas.width}px ${deck.canvas.height}px;margin:0}
body{margin:0}
.slide{break-after:page;break-inside:avoid}`,
      });
      await page.evaluate(async () => {
        await (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready;
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      });
      return await page.pdf({ printBackground: true, preferCSSPageSize: true });
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browserP) {
      const b = await this.browserP;
      this.browserP = undefined;
      await b.close();
    }
  }
}
