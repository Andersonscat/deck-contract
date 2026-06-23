import { describe, it, expect } from "vitest";
import { parseDeck } from "@deck/contract";
import { compileHtml } from "@deck/compile";
import { makeDeck } from "../../core/test/_fixture.js";

describe("compileHtml", () => {
  it("emits a data-cid for every node so the renderer can measure it", () => {
    const { html } = compileHtml(parseDeck(makeDeck()));
    for (const id of [
      "slide_01",
      "col_left",
      "title_main",
      "bullets_main",
      "metric_rev",
      "img_dash",
    ]) {
      expect(html).toContain(`data-cid="${id}"`);
    }
  });

  it("resolves style tokens to CSS variables (no raw values leak)", () => {
    const { html, css } = compileHtml(parseDeck(makeDeck()));
    expect(html).toContain("color:var(--color-text)");
    expect(html).toContain("font-family:var(--font-heading)");
    // theme is the only place raw values live, inside :root
    expect(css).toContain("--color-accent: #ec5a13;");
    expect(css).toContain("--type-h1: 44px;");
  });

  it("is PURE and deterministic: identical output across many runs", () => {
    const deck = parseDeck(makeDeck());
    const first = compileHtml(deck).html;
    for (let i = 0; i < 50; i++) {
      expect(compileHtml(deck).html).toBe(first);
    }
  });

  it("renders the expected leaf markup per node type", () => {
    const { html } = compileHtml(parseDeck(makeDeck()));
    expect(html).toContain("<h1"); // title
    expect(html).toContain("<ul"); // bullet-list
    expect(html).toContain("<li>ARR $1.2M</li>");
    expect(html).toContain('class="stat-value">3.0x</div>');
    expect(html).toContain("<figure");
  });

  it("renders a framed node as absolute % position with canonical formatting", () => {
    const deck = parseDeck(makeDeck());
    deck.slides[0]!.children![0]!.children![0]!.frame = { x: 12.5, y: 50, w: 40 };
    const { html } = compileHtml(deck);
    expect(html).toContain("position:absolute");
    expect(html).toContain("left:12.5%");
    expect(html).toContain("top:50%");
    expect(html).toContain("width:40%");
  });

  it("escapes user content", () => {
    const deck = parseDeck(makeDeck());
    deck.slides[0]!.children![0]!.children![0]!.content!.text = "A & B <script>";
    const { html } = compileHtml(deck);
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
