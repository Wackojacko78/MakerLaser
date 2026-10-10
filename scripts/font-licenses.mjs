#!/usr/bin/env node
// Lists the licence each bundled font package declares (read from its package.json), so the notices
// can be checked before a release. Run from the repo root after `npm install`:
//     node scripts/font-licenses.mjs
// Exit code 1 if a package is missing or declares a licence this project has not decided to accept.

import fs from 'node:fs';
import path from 'node:path';

const PACKAGES = ["roboto", "open-sans", "lato", "montserrat", "poppins", "nunito", "raleway", "inter", "oswald", "merriweather", "playfair-display", "lora", "pt-serif", "cinzel", "roboto-slab", "bitter", "bebas-neue", "anton", "abril-fatface", "archivo-black", "righteous", "bangers", "black-ops-one", "orbitron", "press-start-2p", "pacifico", "dancing-script", "lobster", "great-vibes", "caveat", "permanent-marker", "satisfy", "source-code-pro", "jetbrains-mono", "roboto-mono"];
const ACCEPTED = new Set(['OFL-1.1', 'Apache-2.0', 'MIT']);

const root = process.cwd();
const find = (name) => {
  for (const base of ['node_modules', 'apps/desktop-ui/node_modules']) {
    const file = path.join(root, base, '@fontsource', name, 'package.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
};

let problems = 0;
console.log('| Package | Version | Licence |');
console.log('|---|---|---|');
for (const name of PACKAGES) {
  const pkg = find(name);
  if (!pkg) {
    console.log(`| @fontsource/${name} | NOT INSTALLED | |`);
    problems += 1;
    continue;
  }
  const licence = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'none declared');
  const flag = ACCEPTED.has(licence) ? '' : '  <-- check this one';
  if (flag) problems += 1;
  console.log(`| @fontsource/${name} | ${pkg.version} | ${licence}${flag} |`);
}
console.log(problems === 0 ? '\nAll licences are ones this project accepts (OFL-1.1, Apache-2.0, MIT).' : `\n${problems} package(s) need attention.`);
process.exit(problems === 0 ? 0 : 1);
