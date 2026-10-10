import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS, allCssImportPaths, npmInstallCommand } from '../src/lib/bundledFonts';

// Reads files with Node's own fs. The module name is built at run time so TypeScript does not need
// Node's type definitions to compile this test.
interface NodeFs {
  readFileSync(path: URL, encoding: 'utf8'): string;
  existsSync(path: URL): boolean;
}
async function nodeFs(): Promise<NodeFs> {
  const name = 'node:' + 'fs';
  return (await import(/* @vite-ignore */ name)) as NodeFs;
}

const HINT = `The font packages are not installed. From the repo root run:\n${npmInstallCommand()}`;

describe('the font packages', () => {
  it('are listed in apps/desktop-ui/package.json', async () => {
    const fs = await nodeFs();
    const json = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const have = { ...json.devDependencies, ...json.dependencies };
    const missing = BUNDLED_FONTS.map((f) => `@fontsource/${f.pkg}`).filter((name) => !(name in have));
    expect(missing, HINT).toEqual([]);
  });

  it('are installed, with every CSS file the app imports', async () => {
    const fs = await nodeFs();
    // The workspace hoists packages to the repo root; look in each folder above this one.
    const roots = ['../node_modules', '../../node_modules', '../../../node_modules'];
    const present = (rel: string): boolean => roots.some((root) => fs.existsSync(new URL(`${root}/${rel}`, import.meta.url)));
    const missing = allCssImportPaths().filter((p) => !present(p));
    expect(missing, HINT).toEqual([]);
  });
});
