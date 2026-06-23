import type { Deck } from "@deck/contract";

export function makeDeck(): Deck {
  return {
    spec: "deck-contract/1",
    id: "deck_demo",
    title: "Demo",
    theme: {
      color: { accent: "#ec5a13", text: "#111111", "text-muted": "#666666", bg: "#ffffff" },
      font: { heading: "Inter, sans-serif", body: "Inter, sans-serif" },
      type: { h1: "44px", body: "18px", caption: "13px", display: "64px" },
      space: { sm: "8px", md: "16px", lg: "24px", xl: "40px" },
      radius: { md: "12px" },
    },
    canvas: { width: 1280, height: 720 },
    slides: [
      {
        id: "slide_01",
        type: "slide",
        role: "content",
        layout: { direction: "row", gap: "token://space/lg", padding: "token://space/xl" },
        children: [
          {
            id: "col_left",
            type: "container",
            layout: { direction: "column", gap: "token://space/md", sizing: { width: "fill" } },
            children: [
              {
                id: "title_main",
                type: "title",
                role: "slide-title",
                content: { text: "Revenue grew 3x" },
                style: {
                  color: "token://color/text",
                  font: "token://font/heading",
                  size: "token://type/h1",
                },
                constraints: { maxChars: 60, overflow: "shrink-to-fit" },
              },
              {
                id: "bullets_main",
                type: "bullet-list",
                content: { items: ["ARR $1.2M", "Retention 92%", "Two enterprise logos"] },
                style: {
                  color: "token://color/text",
                  marker: "token://color/accent",
                  size: "token://type/body",
                },
              },
              {
                id: "metric_rev",
                type: "stat-callout",
                content: { value: "3.0x", label: "YoY revenue", delta: "+204%" },
                style: { valueColor: "token://color/accent", valueSize: "token://type/display" },
              },
            ],
          },
          {
            id: "img_dash",
            type: "image-caption",
            content: { src: "asset://images/d.png", alt: "dash", caption: "Q3 dashboard" },
            style: { radius: "token://radius/md" },
            layout: { sizing: { width: "fill", height: "fill" } },
          },
        ],
      },
    ],
  };
}
