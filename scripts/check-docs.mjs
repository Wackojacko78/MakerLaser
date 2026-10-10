#!/usr/bin/env node
// Checks that the documentation still matches the repository. Run from the repo root:
//
//     node scripts/check-docs.mjs            report problems (exit 1 if there are errors)
//     node scripts/check-docs.mjs --strict   warnings also fail
//
// What it checks:
//   links      every relative Markdown link [text](path) points at a file or folder that exists
//   paths      every file path written in `backticks` exists somewhere in the repository
//   index      every file in docs/ is listed in docs/README.md
//   commands   every Tauri command registered in apps/rust-core/src/main.rs is in docs/api.md,
//              and every command in docs/api.md is registered
//   versions   the version in Cargo.toml, package.json files and tauri.conf.json agree, and the
//              newest numbered CHANGELOG heading matches
//   copies     two Markdown files with the same name and the same text (a stray duplicate)
//
// No dependencies. The checks are in `checkDocs`, which the tests in check-docs.test.mjs call.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'build', 'gen', 'coverage', '.vite']);
// Folders whose Markdown is not ours to check (test inputs, vendored packages).
const SKIP_DOC_DIRS = new Set(['fixtures']);
const PATH_EXTENSIONS = 'md|ts|tsx|rs|mjs|ps1|sh|json|toml|yml|yaml|html|css';
// File names that documents mention but that are not files in the repository (for example a name
// inside a .mlp project archive).
const NOT_REPO_FILES = new Set(['project.json']);

/** Every file under `root` (relative paths with forward slashes), skipping build and vendor folders. */
export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else {
        out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '');

/** The text of a Markdown file with fenced code blocks blanked out, keeping line numbers. */
export function withoutFences(text) {
  let inside = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inside = !inside;
        return '';
      }
      return inside ? '' : line;
    })
    .join('\n');
}

/** Relative Markdown links in a file: [text](target). Absolute URLs, mail links and bare #anchors are left out. */
export function markdownLinks(text) {
  const links = [];
  withoutFences(text)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
        links.push({ line: i + 1, target: target.split('#')[0].split('?')[0] });
      }
    });
  return links.filter((l) => l.target !== '');
}

/** File names and paths written in `backticks` that look like files in this repository. */
export function backtickedPaths(text) {
  const found = [];
  const pattern = new RegExp('^[A-Za-z0-9_.@/-]+\\.(?:' + PATH_EXTENSIONS + ')$');
  withoutFences(text)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const p = m[1].trim();
        if (!pattern.test(p) || NOT_REPO_FILES.has(p)) continue;
        if (/[*<>{}~]|\.\.|^\/|^\.\//.test(p) || /^(node_modules|target|dist|build)\//.test(p)) continue;
        found.push({ line: i + 1, path: p });
      }
    });
  return found;
}

/** The first column of the command table in docs/api.md: every `name` in it. */
export function documentedCommands(apiText) {
  const names = new Set();
  for (const line of withoutFences(apiText).split('\n')) {
    if (!line.startsWith('|')) continue;
    const firstCell = line.split('|')[1] ?? '';
    for (const m of firstCell.matchAll(/`([a-z][a-z0-9_]*)`/g)) names.add(m[1]);
  }
  names.delete('command');
  return names;
}

/** The commands listed in the `generate_handler![...]` call in main.rs (the last part of each path). */
export function registeredCommands(mainText) {
  const body = /generate_handler!\s*\[([\s\S]*?)\]/.exec(mainText);
  if (!body) return null;
  const names = new Set();
  for (const item of body[1].split(',')) {
    const cleaned = item.replace(/\/\/.*$/gm, '').trim();
    if (cleaned === '') continue;
    names.add(cleaned.split('::').pop().trim());
  }
  return names;
}

/** Every version number found in the files that carry one, as [file, version]. */
export function versionsIn(root, files) {
  const found = [];
  for (const rel of files) {
    const base = rel.split('/').pop();
    if (base === 'Cargo.toml' && rel.split('/').length <= 1) {
      // Only the version of the workspace or package itself, not the versions of dependencies.
      const section = /^\[(?:workspace\.package|package)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(read(root, rel));
      const m = section ? /^\s*version\s*=\s*"([^"]+)"/m.exec(section[1]) : null;
      if (m) found.push([rel, m[1]]);
    } else if (base === 'package.json' && !rel.includes('node_modules')) {
      try {
        const v = JSON.parse(read(root, rel)).version;
        if (typeof v === 'string') found.push([rel, v]);
      } catch {
        /* not valid JSON: reported elsewhere */
      }
    } else if (base === 'tauri.conf.json') {
      try {
        const v = JSON.parse(read(root, rel)).version;
        if (typeof v === 'string') found.push([rel, v]);
      } catch {
        /* not valid JSON */
      }
    }
  }
  return found;
}

/**
 * Runs every check. Returns { errors, warnings, notes }, each a list of strings.
 * `errors` are things that are certainly wrong; `warnings` are things worth a look.
 */
export function checkDocs(root) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const files = listFiles(root);
  const fileSet = new Set(files);
  const dirSet = new Set();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i += 1) dirSet.add(parts.slice(0, i).join('/'));
  }
  const exists = (rel) => fileSet.has(rel) || dirSet.has(rel);
  const markdown = files.filter(
    (f) => f.endsWith('.md') && !f.split('/').some((p) => SKIP_DOC_DIRS.has(p)) && !/^(apps\/rust-core\/icons)\//.test(f),
  );

  // links
  for (const doc of markdown) {
    const dir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '';
    for (const link of markdownLinks(read(root, doc))) {
      const resolved = path.posix.normalize(path.posix.join(dir, link.target)).replace(/\/$/, '');
      if (!exists(resolved)) errors.push(`${doc}:${link.line}: the link to ${link.target} goes nowhere`);
    }
  }

  // backticked paths
  const roots = ['', 'apps/desktop-ui/', 'apps/rust-core/', 'apps/desktop-ui/src/'];
  for (const doc of markdown) {
    const dir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/') + 1) : '';
    const reported = new Set();
    for (const { line, path: p } of backtickedPaths(read(root, doc))) {
      if (reported.has(p)) continue;
      const near = [dir, ...roots].some((base) => exists(path.posix.normalize(base + p)));
      const anywhere = files.some((f) => f === p || f.endsWith('/' + p));
      if (!near && !anywhere) {
        reported.add(p);
        warnings.push(`${doc}:${line}: \`${p}\` is not in the repository`);
      }
    }
  }

  // index
  if (!fileSet.has('docs/README.md')) {
    errors.push('docs/README.md (the index of the documentation) is missing');
  } else {
    const index = read(root, 'docs/README.md');
    for (const f of markdown.filter((m) => /^docs\/[^/]+\.md$/.test(m) && m !== 'docs/README.md')) {
      const name = f.slice('docs/'.length);
      if (!index.includes(`(${name})`) && !index.includes(`](${name}#`)) errors.push(`${f} is not listed in docs/README.md`);
    }
  }

  // commands
  if (fileSet.has('apps/rust-core/src/main.rs') && fileSet.has('docs/api.md')) {
    const registered = registeredCommands(read(root, 'apps/rust-core/src/main.rs'));
    if (registered === null) {
      notes.push('commands: no generate_handler! list found in apps/rust-core/src/main.rs, so the command table was not checked');
    } else {
      const documented = documentedCommands(read(root, 'docs/api.md'));
      for (const name of [...registered].sort()) {
        if (!documented.has(name)) errors.push(`docs/api.md does not list the command \`${name}\``);
      }
      for (const name of [...documented].sort()) {
        if (!registered.has(name)) errors.push(`docs/api.md lists \`${name}\`, which is not registered in main.rs`);
      }
    }
  } else {
    notes.push('commands: apps/rust-core/src/main.rs or docs/api.md was not found, so the command table was not checked');
  }

  // versions
  const versions = versionsIn(root, files);
  const distinct = [...new Set(versions.map((v) => v[1]))];
  if (distinct.length > 1) {
    errors.push('the version differs between files: ' + versions.map(([f, v]) => `${f} ${v}`).join(', '));
  } else if (distinct.length === 1 && fileSet.has('CHANGELOG.md')) {
    const heading = /^##\s+v?(\d+\.\d+\.\d+\S*)/m.exec(read(root, 'CHANGELOG.md'));
    if (heading && heading[1] !== distinct[0]) {
      warnings.push(`the code says ${distinct[0]} but the newest numbered CHANGELOG heading is ${heading[1]}`);
    }
  }

  // copies
  const byName = new Map();
  for (const f of markdown) {
    const name = f.split('/').pop();
    if (name === 'README.md') continue;
    const hash = createHash('sha256').update(read(root, f).replace(/\r\n/g, '\n')).digest('hex');
    const key = name + ' ' + hash;
    byName.set(key, [...(byName.get(key) ?? []), f]);
  }
  for (const copies of byName.values()) {
    if (copies.length > 1) warnings.push(`the same text is in ${copies.join(' and ')}: one of them is a stray copy`);
  }

  return { errors, warnings, notes };
}

function main() {
  const strict = process.argv.includes('--strict');
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'docs'))) {
    console.error('Run this from the MakerLaser repo root (the folder that contains docs/).');
    process.exit(2);
  }
  const { errors, warnings, notes } = checkDocs(root);
  for (const n of notes) console.log('note     ' + n);
  for (const w of warnings) console.log('warning  ' + w);
  for (const e of errors) console.log('ERROR    ' + e);
  console.log(
    `\n${errors.length} error(s), ${warnings.length} warning(s).` +
      (errors.length + warnings.length === 0 ? ' The documentation matches the repository.' : ''),
  );
  process.exit(errors.length > 0 || (strict && warnings.length > 0) ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
