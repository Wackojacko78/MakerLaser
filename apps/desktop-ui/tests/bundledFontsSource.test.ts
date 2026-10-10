import { describe, expect, it } from 'vitest';
import { allCssImportPaths } from '../src/lib/bundledFonts';

// Reads files with Node's own fs. The module name is built at run time so TypeScript does not need
// Node's type definitions to compile this test.
interface NodeFs {
  readFileSync(path: URL, encoding: 'utf8'): string;
}
async function nodeFs(): Promise<NodeFs> {
  const name = 'node:' + 'fs';
  return (await import(/* @vite-ignore */ name)) as NodeFs;
}

describe('fonts/bundled.ts', () => {
  it('imports exactly the CSS files the font list needs: no font is listed without its files, none is imported without being listed', async () => {
    const fs = await nodeFs();
    const source = fs.readFileSync(new URL('../src/fonts/bundled.ts', import.meta.url), 'utf8');
    const imported = [...source.matchAll(/^import '([^']+)';\s*$/gm)].map((m) => m[1] ?? '');
    const wanted = allCssImportPaths();
    const missing = wanted.filter((p) => !imported.includes(p));
    const extra = imported.filter((p) => !wanted.includes(p));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect(new Set(imported).size).toBe(imported.length);
  });
});
