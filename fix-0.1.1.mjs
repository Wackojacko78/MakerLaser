#!/usr/bin/env node
// MakerLaser 0.1.1 patch: fixes the first-build problems reported by verification.log.
//
//   cd C:\Dev\MakerLaser
//   node fix-0.1.1.mjs
//   cargo fmt --all
//   .\verify-makerlaser.ps1 --skip-ui
//
// Safe to run more than once. Every edit is matched on the exact code, so if a file has
// been changed in a way the patch does not recognise it reports "NOT FOUND" and leaves the
// file alone.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
if (!existsSync(path.join(root, 'Cargo.toml')) || !existsSync(path.join(root, 'packages'))) {
  console.error('Run this from the MakerLaser repository root (the folder containing Cargo.toml).');
  process.exit(2);
}

const edits = [
  {
    why: 'COMPILE ERROR (machine_cmds.rs:212): `&lock(..)?` makes the compiler expect a ProjectFile, not a lock guard',
    file: 'apps/rust-core/src/commands/machine_cmds.rs',
    find: /let current = fingerprint\(&lock\(&state\.project\)\?\);/,
    replace: 'let project = lock(&state.project)?;\n        let current = fingerprint(&project);',
    done: /let current = fingerprint\(&project\);/,
  },
  {
    why: 'CLIPPY ERROR (deny-by-default): 3.14 in a test looks like an approximation of PI',
    file: 'packages/common/src/geometry_types.rs',
    find: /Point2::new\(3\.14, 2\.71\)/,
    replace: 'Point2::new(3.25, 2.5)',
    done: /Point2::new\(3\.25, 2\.5\)/,
  },
  {
    why: 'warning: unused test import `Layer` (cam.rs)',
    file: 'packages/project/src/cam.rs',
    find: /(\bImageFormat,\s*)Layer,\s*/,
    replace: '$1',
    done: /ImageFormat,\s*MachineProfile/,
  },
  {
    why: 'clippy: negated float comparison (layers.rs); now also NaN-safe by construction',
    file: 'packages/common/src/layers.rs',
    find: /!\(self\.line_spacing_mm >= 0\.01\)/,
    replace: '(self.line_spacing_mm.is_nan() || self.line_spacing_mm < 0.01)',
    done: /self\.line_spacing_mm\.is_nan\(\)/,
  },
  {
    why: 'clippy: negated float comparison (machine.rs)',
    file: 'packages/common/src/machine.rs',
    find: /if !\(self\.max_feed_rate_mm_min > 0\.0\) \{/,
    replace: 'if self.max_feed_rate_mm_min.is_nan() || self.max_feed_rate_mm_min <= 0.0 {',
    done: /self\.max_feed_rate_mm_min\.is_nan\(\)/,
  },
  {
    why: 'clippy: needless range loop (dxf_import.rs, De Boor evaluation)',
    file: 'packages/geometry/src/dxf_import.rs',
    find: /for c in 0\.\.3 \{\s*d\[j\]\[c\] = \(1\.0 - alpha\) \* d\[j - 1\]\[c\] \+ alpha \* d\[j\]\[c\];\s*\}/,
    replace:
      'let prev = d[j - 1];\n            for (c, slot) in d[j].iter_mut().enumerate() {\n                *slot = (1.0 - alpha) * prev[c] + alpha * *slot;\n            }',
    done: /let prev = d\[j - 1\];/,
  },
  {
    why: 'clippy: extend(drain(..)) should be append (join.rs)',
    file: 'packages/geometry/src/join.rs',
    find: /c\.points\.extend\(chain\.points\.drain\(\.\.\)\);/,
    replace: 'c.points.append(&mut chain.points);',
    done: /c\.points\.append\(&mut chain\.points\);/,
  },
  {
    why: 'verify script: run every test binary even if one fails, so all failures show at once',
    file: 'scripts/verify.mjs',
    find: /\['test', '--workspace'\]/,
    replace: "['test', '--workspace', '--no-fail-fast']",
    done: /--no-fail-fast/,
  },
];

let applied = 0;
let skipped = 0;
let missing = 0;

for (const e of edits) {
  const full = path.join(root, e.file);
  if (!existsSync(full)) {
    console.log(`MISSING FILE  ${e.file}`);
    missing++;
    continue;
  }
  const text = readFileSync(full, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (e.done.test(text) && !e.find.test(text)) {
    console.log(`already done  ${e.file}`);
    skipped++;
    continue;
  }
  if (!e.find.test(text)) {
    console.log(`NOT FOUND     ${e.file}\n              (${e.why})\n              apply this one by hand; see the notes in the chat`);
    missing++;
    continue;
  }
  const replacement = e.replace.replace(/\n/g, eol);
  writeFileSync(full, text.replace(e.find, replacement));
  console.log(`patched       ${e.file}\n              ${e.why}`);
  applied++;
}

console.log(`\n${applied} patched, ${skipped} already done, ${missing} need attention.`);
if (applied > 0) console.log('Next: cargo fmt --all   then   .\\verify-makerlaser.ps1 --skip-ui');
process.exit(missing > 0 ? 1 : 0);
