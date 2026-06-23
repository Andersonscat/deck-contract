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
```

## Status

- [x] **Day 1** — contract, core (tree/ids/ops), pure compile, tests without a browser
- [x] **Day 2** — `LocalChromiumRenderer`: warm browser, network-blocked, fonts awaited,
      deterministic overflow / out-of-bounds measurement, PNG screenshots
- [x] **Day 3** — render-and-check loop (monotone gate, anti-oscillation, bounded iters);
      proven to converge on golden fixtures with a deterministic solver (406→192→48→0px)
- [ ] **Day 4** — 7 MCP tools, PDF export, package loader, wire a real model over the loop
