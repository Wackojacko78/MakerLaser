// Tests for scripts/check-docs.mjs. Run with:  node --test scripts/check-docs.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  backtickedPaths,
  checkDocs,
  documentedCommands,
  markdownLinks,
  registeredCommands,
  withoutFences,
} from './check-docs.mjs';

/** Makes a small repository in a temporary folder from { 'path': 'text' }. */
function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkdocs-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return root;
}

/** A repository that passes every check: the starting point most tests change one thing in. */
const GOOD = {
  'README.md': '# Project\n\nSee [the docs](docs/README.md) and `docs/one.md`.\n',
  'docs/README.md': '# Docs\n\n* [One](one.md)\n* [Api](api.md)\n',
  'docs/one.md': '# One\n\nBack to [the readme](../README.md).\n',
  'docs/api.md': '# API\n\n| Command | Arguments |\n|---|---|\n| `new_project` | |\n| `save_project_as` / `save_project` | `path` |\n',
  'apps/rust-core/src/main.rs':
    'fn main() { tauri::Builder::default().invoke_handler(tauri::generate_handler![\n  commands::project_cmds::new_project,\n  project_cmds::save_project_as,\n  save_project, // comment\n]); }\n',
  'Cargo.toml': '[workspace]\nmembers = ["a"]\n\n[workspace.package]\nversion = "0.2.0"\n\n[workspace.dependencies.serde]\nversion = "1"\n',
  'package.json': '{ "name": "x", "version": "0.2.0" }\n',
  'apps/desktop-ui/package.json': '{ "name": "ui", "version": "0.2.0" }\n',
  'apps/rust-core/tauri.conf.json': '{ "version": "0.2.0" }\n',
  'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n- x\n\n## 0.2.0\n\n- y\n',
};

const run = (files) => checkDocs(repo({ ...GOOD, ...files }));

test('a repository whose documentation is right has nothing to report', () => {
  const r = checkDocs(repo(GOOD));
  assert.deepEqual(r, { errors: [], warnings: [], notes: [] });
});

test('withoutFences blanks code blocks and keeps line numbers', () => {
  const text = 'a\n```\n[x](y.md)\n```\nb';
  assert.equal(withoutFences(text), 'a\n\n\n\nb');
  assert.equal(withoutFences('~~~\ncode\n~~~\nz').split('\n').length, 4);
});

test('markdownLinks finds relative links, with the line, and ignores the rest', () => {
  const text = [
    '[a](one.md) and [b](dir/two.md#part) and [c](https://x.org/y)',
    '[d](#top) [e](mailto:a@b.c) [f](//cdn/x) [g](three.md "title")',
    '```',
    '[hidden](nothing.md)',
    '```',
  ].join('\n');
  assert.deepEqual(markdownLinks(text), [
    { line: 1, target: 'one.md' },
    { line: 1, target: 'dir/two.md' },
    { line: 2, target: 'three.md' },
  ]);
});

test('backtickedPaths finds file paths and leaves out code, patterns and folders that are generated', () => {
  const text = [
    'Edit `src/lib/a.ts` and `README.md`, run `npm test`, set `x = 1`.',
    'Not these: `node_modules/@fontsource/<name>/LICENSE`, `src/*.ts`, `../up.md`, `/abs.md`, `target/release/x.json`.',
    '`apps/rust-core/tauri.conf.json` counts.',
    '```',
    '`fenced/in-a-block.ts`',
    '```',
  ].join('\n');
  assert.deepEqual(
    backtickedPaths(text).map((p) => p.path),
    ['src/lib/a.ts', 'README.md', 'apps/rust-core/tauri.conf.json'],
  );
});

test('a name that is inside a project archive and not a file in the repository is not looked for', () => {
  assert.deepEqual(backtickedPaths('The archive holds `project.json` and `src/a.ts`.').map((p) => p.path), ['src/a.ts']);
});

test('documentedCommands reads every name in the first column, including several in one row', () => {
  const api = '| Command | Arguments |\n|---|---|\n| `a_one` | `x` |\n| `b_two` / `c_three` | |\n| plain | `not_a_command` |\n';
  assert.deepEqual([...documentedCommands(api)].sort(), ['a_one', 'b_two', 'c_three']);
});

test('registeredCommands reads the last part of each path and ignores comments', () => {
  const main = 'x(tauri::generate_handler![ a::b::first, second, // note\n  third_one,\n ])';
  assert.deepEqual([...registeredCommands(main)], ['first', 'second', 'third_one']);
  assert.equal(registeredCommands('fn main() {}'), null);
});

test('a link to a file that is not there is an error, with the file and line', () => {
  const r = run({ 'docs/one.md': '# One\n\ntext\n[gone](missing.md)\n' });
  assert.deepEqual(r.errors, ['docs/one.md:4: the link to missing.md goes nowhere']);
});

test('a link to a folder, or with an anchor, is fine', () => {
  const r = run({ 'docs/one.md': '[a](../apps/rust-core) [b](../README.md#top)\n' });
  assert.deepEqual(r.errors, []);
});

test('a file path in backticks that is not in the repository is a warning, once per file', () => {
  const r = run({ 'docs/one.md': 'Uses `src/lib/nothing.ts` and again `src/lib/nothing.ts`.\n' });
  assert.deepEqual(r.warnings, ['docs/one.md:1: `src/lib/nothing.ts` is not in the repository']);
  assert.deepEqual(r.errors, []);
});

test('a path written relative to the UI, or only by its file name, is found', () => {
  const r = run({
    'apps/desktop-ui/src/lib/measure.ts': 'export {};\n',
    'docs/one.md': '`src/lib/measure.ts` and `measure.ts` and `apps/desktop-ui/src/lib/measure.ts` and `tauri.conf.json`.\n',
  });
  assert.deepEqual(r.warnings, []);
});

test('a document that is not in the index is an error', () => {
  const r = run({ 'docs/extra.md': '# Extra\n' });
  assert.deepEqual(r.errors, ['docs/extra.md is not listed in docs/README.md']);
});

test('a missing index is an error', () => {
  const files = { ...GOOD };
  delete files['docs/README.md'];
  const r = checkDocs(repo(files));
  assert.ok(r.errors.some((e) => e.includes('docs/README.md (the index')));
});

test('a command that is registered but not documented, and one documented but not registered, are errors', () => {
  const main = 'x(tauri::generate_handler![ new_project, brand_new ])';
  const r = run({ 'apps/rust-core/src/main.rs': main });
  assert.deepEqual(r.errors, [
    'docs/api.md does not list the command `brand_new`',
    'docs/api.md lists `save_project`, which is not registered in main.rs',
    'docs/api.md lists `save_project_as`, which is not registered in main.rs',
  ]);
});

test('without main.rs the command table is not checked, and a note says so', () => {
  const files = { ...GOOD };
  delete files['apps/rust-core/src/main.rs'];
  const r = checkDocs(repo(files));
  assert.deepEqual(r.errors, []);
  assert.equal(r.notes.length, 1);
});

test('versions that differ between files are an error that names them all', () => {
  const r = run({ 'apps/desktop-ui/package.json': '{ "version": "0.1.0" }\n' });
  assert.equal(r.errors.length, 1);
  assert.ok(r.errors[0].includes('apps/desktop-ui/package.json 0.1.0') && r.errors[0].includes('package.json 0.2.0'), r.errors[0]);
});

test('the version of a dependency in Cargo.toml is not mistaken for the version of the project', () => {
  const r = run({ 'Cargo.toml': '[workspace.dependencies.serde]\nversion = "1"\n\n[workspace.package]\nversion = "0.2.0"\n' });
  assert.deepEqual(r.errors, []);
});

test('a changelog whose newest numbered heading is not the code version is a warning', () => {
  const r = run({ 'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n## 0.1.0\n' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.ok(r.warnings[0].includes('0.2.0') && r.warnings[0].includes('0.1.0'));
});

test('two Markdown files with the same name and text are reported as a stray copy', () => {
  const r = run({ 'catalog.md': '# Catalogue\n', 'docs/catalog.md': '# Catalogue\n', 'docs/README.md': '# Docs\n(one.md) (api.md) (catalog.md)\n' });
  assert.equal(r.warnings.length, 1);
  assert.ok(r.warnings[0].includes('catalog.md and docs/catalog.md'), r.warnings[0]);
});

test('the same name with different text, and line endings alone, are not copies', () => {
  const different = run({ 'a/notes.md': 'one\n', 'b/notes.md': 'two\n' });
  assert.deepEqual(different.warnings, []);
  const crlf = run({ 'a/notes.md': 'one\ntwo\n', 'b/notes.md': 'one\r\ntwo\r\n' });
  assert.equal(crlf.warnings.length, 1);
});

test('build folders, node_modules and test fixtures are not checked', () => {
  const r = run({
    'node_modules/pkg/README.md': '[broken](nowhere.md) `x/y.ts`\n',
    'target/doc/a.md': '[broken](nowhere.md)\n',
    'tests/fixtures/sample.md': '[broken](nowhere.md)\n',
  });
  assert.deepEqual(r, { errors: [], warnings: [], notes: [] });
});

test('a file with a byte-order mark and Windows line endings is read normally', () => {
  const r = run({ 'docs/one.md': '\uFEFF# One\r\n\r\n[gone](missing.md)\r\n' });
  assert.deepEqual(r.errors, ['docs/one.md:3: the link to missing.md goes nowhere']);
});
