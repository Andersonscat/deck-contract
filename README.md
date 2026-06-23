# deck-contract

An open standard + reference MCP server for **AI-native editable artifacts**. An AI
edits **one component** of a deck surgically (by stable id) instead of regenerating the
whole slide. No font drift (style is theme-token-only), no overflow (constraints +
a render-and-check loop). First domain: **presentations**. Designed to extend to docs /
resume / landing / LaTeX through the same contract.

Inference runs on the user's own AI subscription via MCP (the tool pays $0 for tokens);
rendering is local (Chromium, $0 COGS).

## Architecture (functional core / imperative shell)

```
template package (data)
  -> deck.json            immutable tree, stable string ids
  -> apply(deck, ops[])   pure, transactional (all-or-nothing), inverse for free
  -> compileHtml(deck)    PURE, zero I/O -> deterministic HTML/CSS
  -> render (Day 2)       Playwright -> PNG + machine-readable issues[]
  -> loop: model -> apply_patch -> render -> until issues = []
  -> export PDF
```

MCP, Playwright and git are swappable adapters at the edge; the core knows nothing
about transport.

## Packages

| package           | role                                                            |
| ----------------- | --------------------------------------------------------------- |
| `@deck/contract`  | Zod schemas, contract version, `issues[]` enum. Zero deps.      |
| `@deck/core`      | immutable tree, stable id allocator, transactional `apply`+inverse, token validation |
| `@deck/compile`   | `compileHtml(deck)` — pure, deterministic deck → HTML/CSS        |
| `@deck/renderer`  | `LocalChromiumRenderer` — headless Chromium → PNG + `issues[]` (overflow/out-of-bounds) |
| `@deck/loop`      | render-and-check loop with monotone gate + anti-oscillation + bounded iters |
| `@deck/loader`    | `FileTemplateSource` — resolve self-contained template packages from a folder/git |
| `@deck/mcp-server`| 10 MCP tools over stdio (thin shell); handle-based state behind a `DeckStore` |
| `@deck/viewer`    | local interactive viewer — click to select, edit text, mark an "AI target"; live reload |

Dependency rule: everything depends on `contract`; `contract` depends on nothing. The
domain ("slide", "title") must never leak into `core`/`contract`.

## Load-bearing invariants (expensive to change later)

1. **Stable string ids** are identity — ops address nodes by id, never by position.
2. **Token-only style** — node styles are token refs only; raw hex/px are rejected at
   the schema boundary, so font drift has nothing to drift to.
3. **`compileHtml` is pure** — no I/O, time, or randomness; same deck → byte-identical HTML.
4. **Versioned format** — `spec: "deck-contract/1"`, tolerant reader, open node `type`.

## Develop

```bash
pnpm install
pnpm --filter @deck/renderer exec playwright install chromium   # one-time
pnpm test        # 38 tests: id stability, atomicity, inverse, token-only, determinism, render, convergence
pnpm preview     # compile the sample deck -> examples/out/preview.html
pnpm render      # surgical edit -> headless Chromium -> examples/out/slide-*.png
pnpm loop        # run the fix loop on an overflowing deck -> monotone descent + before/after PNGs
pnpm agent       # drive the MCP tools as a model would -> examples/out/deck-*.png + deck.pdf
pnpm viewer      # open the interactive viewer on a working deck (http://localhost:4570)
```

## Two ways to edit — you and the AI, one deck.json

The point is not full AI generation. The source of truth is one `deck.json`, and both
you and the model edit it through the same id-addressed ops:

- **You, directly** — `pnpm viewer` renders the live deck. Click any element to see its
  stable id; double-click a title/heading to edit text in place; edits write back and
  reload live.
- **You point, the AI acts** — click an element and hit "Set as AI target". The model
  (via `get_selection`) reads exactly what you pointed at, then `apply_patch` changes it.
  With `open_deck` the model edits the very file the viewer shows, so its changes appear
  live in front of you.

## Use it in Claude Code / Cursor

A project-scoped `.mcp.json` is included. From a client that supports MCP, point it at
the stdio server:

```jsonc
{
  "mcpServers": {
    "deck-contract": { "command": "npx", "args": ["tsx", "packages/mcp-server/src/bin.ts"] }
  }
}
```

Then the model has 10 tools: `list_templates`, `load_template`, `open_deck`,
`get_selection`, `get_outline`, `get_node`, `apply_patch`, `insert_block`, `render`,
`export_deck`. A typical turn: `load_template` (or `open_deck` to share the viewer's
file) → `get_selection`/`get_outline` → `apply_patch` (surgical edit) → `render` (see
the PNG + any overflow issues) → fix → `export_deck` (PDF). Inference runs on the
client's own model; this server only edits structure and renders locally.

## Status

- [x] **Day 1** — contract, core (tree/ids/ops), pure compile, tests without a browser
- [x] **Day 2** — `LocalChromiumRenderer`: warm browser, network-blocked, fonts awaited,
      deterministic overflow / out-of-bounds measurement, PNG screenshots
- [x] **Day 3** — render-and-check loop (monotone gate, anti-oscillation, bounded iters);
      proven to converge on golden fixtures with a deterministic solver (406→192→48→0px)
- [x] **Day 4** — 8 MCP tools over stdio, PDF export, template loader + first `minimal-dark`
      package, handle-based session state; full model-flow integration test green

- [x] **Day 5** — interactive viewer (click-select, inline text edit, "AI target");
      `get_selection` + `open_deck` so user and model edit one shared deck.json live

MVP complete: an AI can load a template, surgically edit one component, render and
self-check for overflow, and export a PDF — and the user can see the deck, edit elements
directly, or point the AI at exactly the element they want changed — all on the client's
own model.
