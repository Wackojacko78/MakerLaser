#!/usr/bin/env node
// Runs the Tauri CLI from apps/rust-core, where tauri.conf.json lives. The CLI finds its
// configuration relative to the working directory, and this repository keeps the Rust app
// in `apps/rust-core` rather than the conventional `src-tauri`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const bin = path.join(root, 'node_modules', '.bin', isWindows ? 'tauri.cmd' : 'tauri');

if (!existsSync(bin)) {
  console.error('The Tauri CLI is not installed. Run `npm install` in the repository root first.');
  process.exit(1);
}

const child = spawn(bin, process.argv.slice(2), {
  cwd: path.join(root, 'apps', 'rust-core'),
  stdio: 'inherit',
  shell: isWindows, // .cmd shims need a shell on Windows
});
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(`Could not start the Tauri CLI: ${err.message}`);
  process.exit(1);
});
