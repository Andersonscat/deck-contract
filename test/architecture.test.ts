import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * Layering guardrail (rewrite-forcing decision #2). The functional core must never
 * import the transport (MCP SDK), the renderer (Playwright), or a higher layer.
 * If this ever fails, the core/shell boundary has leaked and the move to hosted /
 * stateless HTTP would become a rewrite.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const refs: string[] = [];
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) refs.push(m[1]!);
  return refs;
}

const FORBIDDEN_EVERYWHERE = [/@modelcontextprotocol/, /(^|\/)playwright/, /ServerTransport/, /StreamableHTTP/];

/** package name -> the only @deck/* deps it may import. */
const ALLOWED_DECK_DEPS: Record<string, string[]> = {
  contract: [],
  core: ["@deck/contract"],
  compile: ["@deck/contract"],
};

describe("layering guardrail", () => {
  for (const pkg of Object.keys(ALLOWED_DECK_DEPS)) {
    it(`@deck/${pkg} respects its allowed dependencies`, () => {
      const files = tsFiles(join(ROOT, "packages", pkg, "src"));
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        for (const ref of importsOf(file)) {
          for (const bad of FORBIDDEN_EVERYWHERE) {
            expect(bad.test(ref), `${file} must not import ${ref}`).toBe(false);
          }
          if (ref.startsWith("@deck/")) {
            expect(
              ALLOWED_DECK_DEPS[pkg]!.includes(ref),
              `${file} imports ${ref}, not allowed for @deck/${pkg}`,
            ).toBe(true);
          }
        }
      }
    });
  }
});
