#!/usr/bin/env node
// One-command verification of the whole repository: Rust (format, compile, test, lint) and
// frontend (install, type-check, test, lint, build). Runs EVERY step by default and prints
// a summary, so a first run shows all problems at once. Output goes to verification.log.
//
//   node scripts/verify.mjs              run everything
//   node scripts/verify.mjs --fail-fast  stop at the first failing step
//   node scripts/verify.mjs --skip-ui    Rust only
//   node scripts/verify.mjs --skip-rust  frontend only
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logFile = path.join(root, 'verification.log');
const args = new Set(process.argv.slice(2));
const isWindows = process.platform === 'win32';

const rustSteps = [
  ['Rust: format (applies rustfmt)', 'cargo', ['fmt', '--all']],
  ['Rust: compile', 'cargo', ['check', '--workspace', '--all-targets']],
  ['Rust: tests', 'cargo', ['test', '--workspace', '--no-fail-fast']],
  ['Rust: clippy', 'cargo', ['clippy', '--workspace', '--all-targets']],
];
const uiSteps = [
  ['UI: install dependencies', 'npm', ['install']],
  ['UI: type-check', 'npm', ['run', 'ui:typecheck']],
  ['UI: tests', 'npm', ['run', 'ui:test']],
  ['UI: lint', 'npm', ['run', 'ui:lint']],
  ['UI: production build', 'npm', ['run', 'ui:build']],
];
const steps = [
  ...(args.has('--skip-ui') ? [] : uiSteps.slice(0, 1)),
  ...(args.has('--skip-rust') ? [] : rustSteps),
  ...(args.has('--skip-ui') ? [] : uiSteps.slice(1)),
];

function version(cmd, flag = '--version') {
  const r = spawnSync(cmd, [flag], { encoding: 'utf8', shell: isWindows });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
}

function log(text) {
  process.stdout.write(text);
  appendFileSync(logFile, text);
}

function run(cmd, cmdArgs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: root, shell: isWindows, env: { ...process.env, CARGO_TERM_COLOR: 'never', FORCE_COLOR: '0' } });
    child.stdout.on('data', (d) => log(d.toString()));
    child.stderr.on('data', (d) => log(d.toString()));
    child.on('error', (e) => {
      log(`could not start ${cmd}: ${e.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

writeFileSync(logFile, `MakerLaser verification ${new Date().toISOString()}\n`);
log(`node  : ${version('node')}\nnpm   : ${version('npm')}\ncargo : ${version('cargo') ?? 'NOT FOUND'}\nrustc : ${version('rustc') ?? 'NOT FOUND'}\n`);

const rustc = version('rustc');
const match = rustc && rustc.match(/rustc (\d+)\.(\d+)/);
if (match && (Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 85))) {
  log('\nWARNING: Rust 1.85 or newer is required (run `rustup update stable`).\n');
}

const results = [];
for (const [name, cmd, cmdArgs] of steps) {
  log(`\n=== ${name}: ${cmd} ${cmdArgs.join(' ')} ===\n`);
  const started = Date.now();
  const code = await run(cmd, cmdArgs);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  results.push({ name, code, seconds });
  log(`--- ${name}: ${code === 0 ? 'PASS' : `FAIL (exit ${code})`} in ${seconds}s\n`);
  if (code !== 0 && args.has('--fail-fast')) break;
}

log('\n=========== SUMMARY ===========\n');
for (const r of results) log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name.padEnd(34)} ${r.seconds}s\n`);
const failed = results.filter((r) => r.code !== 0);
log(failed.length === 0 ? '\nALL STEPS PASSED.\n' : `\n${failed.length} STEP(S) FAILED. Full output: ${logFile}\n`);
process.exit(failed.length === 0 ? 0 : 1);
