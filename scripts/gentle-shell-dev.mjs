#!/usr/bin/env node
// Standalone launcher using Node builtins and local helpers; no installer or Pi imports.
import * as fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir, constants as osConstants } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { findGentlePiDeclaration, packageSourceKind, parseLauncherArgs } from '../runtime/gentle-shell-launcher.mjs';

const checkout = dirname(dirname(fileURLToPath(import.meta.url)));
const home = fs.realpathSync(homedir());
const prefix = join(home, '.gentle-shell');
const manager = join(prefix, 'dev-launcher');
const backupRoot = join(manager, 'backups');
const referencePath = join(manager, 'release-reference.json');
const config = join(prefix, 'config/gentle-ai');
// Exclude models/MCP (may contain secrets), auth, sessions, provisioning/install
// state and native review authority. Never restore a path supplied by a manifest.
const allowlist = ['agent/settings.json', ...[
  'persona', 'background-subagents', 'subagents', 'profiles', 'permission-mode',
  'vim', 'animations', 'notifications', 'history-capture', 'visual-profiles',
  'visual-customization', 'builtin-codemode-optout',
].map(name => `config/gentle-ai/${name}.json`)];
const help = `Gentle Shell · local development
Usage: node scripts/gentle-shell-dev.mjs [command]
       node scripts/gentle-shell-dev.mjs checkout -- [Gentle Shell arguments]
  Example: checkout -- -r (native session selector)
  Forwarded arguments cannot override --home, --isolated or --package-root.
  (no command)  Menu: checkout [default Enter], recover, exit
  checkout      Save/validate trusted release reference, then launch this checkout
  recover       Recover ALL allowlisted config; type yes to confirm
  --help        Show this help (read-only)
Checkout prerequisites: Node >=22.19.0 and the pnpm version in package.json's
packageManager field. Missing local Pi offers Prepare checkout now? [y/N]:
Only y/yes (case-insensitive) consents to pnpm install --frozen-lockfile.
It may download dependencies and run install scripts with side effects (not
sandboxed). The launcher does not update the bundled release or install Node/pnpm.
Blank/no/EOF/other answers decline with manual preparation instructions.
No make install or global install is required. Help, menu, exit and recovery
remain available without checkout dependencies.
Checkout uses --link with normal native loading, preserving built-in opt-outs.
Conflicting npm/local Gentle Shell declarations or ambiguous settings block launch
before preparation and backup. Check shared agent and cwd .pi/settings.json;
settings are never edited. Known Gentle Shell git sources require manual review.
Shared agent data: ~/.gentle-shell/agent. Do not run versions concurrently.
Reference: trusted state before first checkout, NOT proven release provenance.
Immutable reference and safety backups: ~/.gentle-shell/dev-launcher (private).
Recovery restores present files and removes only allowlisted regular files absent
in the reference; never sessions/auth. Preflight then individual atomic writes,
not a transaction: filesystem failures may leave partial recovery. No updates,
unconfirmed dependency installs, reference recapture, or automatic promotion.
Launch the installed release normally with gentle-shell.
EOF exits the menu without launching. See docs/gentle-shell-dev.md.
`;
const backupId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paint = (code, text) => process.stdout.isTTY && !Object.hasOwn(process.env, 'NO_COLOR')
  ? `\x1b[${code}m${text}\x1b[0m` : text;
function json(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`Cannot read JSON at ${path}: ${error.message}`); }
}
function stat(path) {
  try { return fs.lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
}
// Check all home-relative components, including dangling links. Canonicalize
// system home aliases once above (e.g. macOS /var), never config aliases here.
function safe(path, kind = 'file') {
  const rel = relative(home, path);
  if (rel.startsWith('..') || resolve(home, rel) !== path) throw new Error(`Unsafe path: ${path}`);
  const parts = rel.split('/');
  let current = home;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const s = stat(current);
    if (s && (s.isSymbolicLink() || (i < parts.length - 1 || kind === 'dir' ? !s.isDirectory() : !s.isFile()))) {
      throw new Error(`Unsafe path: ${current}`);
    }
  }
}
function mkdir(path) {
  safe(path, 'dir');
  fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  fs.chmodSync(path, 0o700);
}
function atomic(path, bytes) {
  safe(path); mkdir(dirname(path));
  const temp = `${path}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
  safe(path);
  fs.renameSync(temp, path);
}
function validateConfig() {
  for (const name of allowlist) safe(join(prefix, name));
}
function capture(reason) {
  // Read all inputs before creating a snapshot. Reuse this for recovery safety.
  const files = {};
  for (const name of allowlist) {
    const path = join(prefix, name); safe(path);
    if (!stat(path)) { files[name] = null; continue; }
    const bytes = fs.readFileSync(path);
    files[name] = { data: bytes.toString('base64'), sha256: hash(bytes) };
  }
  safe(manager, 'dir'); safe(backupRoot, 'dir');
  const id = randomUUID();
  mkdir(manager);
  mkdir(backupRoot);
  mkdir(join(backupRoot, id));
  const createdAt = new Date().toISOString();
  const bytes = JSON.stringify({ schema: 1, reason, createdAt, files }, null, 2) + '\n';
  atomic(join(backupRoot, id, 'snapshot.json'), bytes);
  return { backup: id, sha256: hash(bytes), createdAt };
}
function loadBackup(id, checksum) {
  if (typeof id !== 'string' || !backupId.test(id)) throw new Error('Invalid backup ID');
  const path = join(backupRoot, id, 'snapshot.json'); safe(path);
  const snapshot = json(path);
  if (hash(fs.readFileSync(path)) !== checksum || snapshot.schema !== 1 || !snapshot.files ||
      Object.keys(snapshot.files).length !== allowlist.length ||
      !allowlist.every(name => Object.hasOwn(snapshot.files, name))) throw new Error('Release reference integrity check failed');
  for (const record of Object.values(snapshot.files)) {
    if (record === null) continue;
    if (typeof record?.data !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256) ||
        Buffer.from(record.data, 'base64').toString('base64') !== record.data ||
        hash(Buffer.from(record.data, 'base64')) !== record.sha256) throw new Error('Backup integrity check failed');
  }
  return snapshot;
}
function reference() {
  safe(referencePath);
  if (!stat(referencePath)) {
    // A lost pointer is not permission to replace a previously trusted baseline.
    // Legacy generic snapshots remain untouched and are never auto-adopted.
    safe(backupRoot, 'dir');
    for (const id of stat(backupRoot) ? fs.readdirSync(backupRoot) : []) {
      if (!backupId.test(id)) continue; // Finder metadata and other unowned entries are not backups.
      const path = join(backupRoot, id, 'snapshot.json'); safe(path);
      if (json(path).reason === 'release reference') throw new Error('Missing release reference; refusing to replace it');
    }
    return null;
  }
  const ref = json(referencePath);
  if (ref?.schema !== 1 || typeof ref.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(ref.createdAt)) || !/^[0-9a-f]{64}$/.test(ref.sha256)) throw new Error('Invalid release reference');
  const saved = loadBackup(ref.backup, ref.sha256);
  if (saved.reason !== 'release reference' || saved.createdAt !== ref.createdAt) throw new Error('Invalid release reference');
  return { ...ref, files: saved.files };
}
function piAt(root) {
  const meta = json(join(root, 'package.json'));
  if (meta.name !== '@earendil-works/pi-coding-agent' || meta.bin?.pi !== 'dist/bundle/cli.js') throw new Error('Unsupported Pi metadata');
  if (!fs.statSync(fs.realpathSync(join(root, meta.bin.pi))).isFile()) throw new Error('Pi CLI missing');
}
function runtime(mode, fresh = false) {
  let node, entry;
  if (mode === 'release') {
    const launcher = join(prefix, 'bin/gentle-shell');
    // Match the installer's POSIX generated launcher, never evaluate shell text.
    const match = /^exec '([^'\n]+)' '([^'\n]+)' "\$@"$/m.exec(fs.readFileSync(launcher, 'utf8'));
    if (!match) throw new Error('Unsupported bundled launcher; expected the generated POSIX launcher');
    node = fs.realpathSync(match[1]);
    entry = fs.realpathSync(match[2]);
    const id = /^versions\/([0-9A-Za-z][0-9A-Za-z.-]*)$/.exec(fs.readlinkSync(join(prefix, 'current')))?.[1];
    if (!id || id.includes('..')) throw new Error('Invalid bundled release');
    const versionDir = join(prefix, 'versions', id);
    safe(versionDir, 'dir');
    const marker = join(versionDir, '.gentle-shell-version'); safe(marker);
    if (fs.realpathSync(join(prefix, 'current')) !== versionDir ||
        fs.readFileSync(marker, 'utf8') !== `${id}\n`) throw new Error('Invalid bundled release');
    const pins = json(join(versionDir, 'package.json')).dependencies;
    // pnpm's public package links resolve into .pnpm inside this version.
    const installed = name => {
      const root = fs.realpathSync(join(versionDir, 'node_modules', name));
      const meta = json(join(root, 'package.json'));
      if (!root.startsWith(`${versionDir}/`) || typeof pins?.[name] !== 'string' ||
          meta.name !== name || meta.version !== pins[name]) throw new Error('Invalid bundled release');
      return root;
    };
    const shellRoot = installed('gentle-pi');
    if (entry !== fs.realpathSync(join(shellRoot, 'bin/gentle-shell.mjs')) ||
        !entry.startsWith(`${shellRoot}/`)) throw new Error('Invalid bundled release');
    const piRoot = installed('@earendil-works/pi-coding-agent');
    if (fs.realpathSync(join(piRoot, 'dist/bundle/cli.js')) !== join(piRoot, 'dist/bundle/cli.js')) throw new Error('Invalid bundled release');
    piAt(piRoot);
  } else {
    node = fs.realpathSync(process.execPath);
    entry = fs.realpathSync(join(checkout, 'bin/gentle-shell.mjs'));
    let resolvedPi;
    try {
      if (fresh) {
        // Node can cache negative ESM resolutions in this process. Resolve from
        // the same script directory in a fresh builtin-only process after install.
        const probe = spawnSync(node, ['--input-type=module', '--eval', `
          try { console.log(JSON.stringify({ url: import.meta.resolve('@earendil-works/pi-coding-agent') })); }
          catch (error) { console.log(JSON.stringify({ message: error.message, code: error.code })); }
        `], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8' });
        if (probe.error) throw probe.error;
        if (probe.status !== 0) throw new Error('Cannot revalidate checkout Pi resolution');
        const result = JSON.parse(probe.stdout);
        if (result.message) throw Object.assign(new Error(result.message), { code: result.code });
        resolvedPi = result.url;
      } else resolvedPi = import.meta.resolve('@earendil-works/pi-coding-agent');
    } catch (error) {
      // Only an absent package gets preparation advice, not damaged metadata,
      // exports or entry files. Never substitute the installed release's Pi.
      if (error.code !== 'ERR_MODULE_NOT_FOUND' ||
          !error.message.startsWith("Cannot find package '@earendil-works/pi-coding-agent' imported from ") ||
          stat(join(checkout, 'node_modules/@earendil-works/pi-coding-agent'))) throw error;
      const quotedCheckout = `'${checkout.replaceAll("'", "'\\''")}'`;
      throw Object.assign(new Error('  Checkout is not prepared: missing @earendil-works/pi-coding-agent.\n' +
        '  Prepare this checkout, then retry the launcher:\n' +
        `    cd ${quotedCheckout}\n    pnpm install --frozen-lockfile\n` +
        '    node scripts/gentle-shell-dev.mjs'), { code: 'CHECKOUT_PI_MISSING' });
    }
    const publicEntry = fs.realpathSync(fileURLToPath(resolvedPi));
    const root = dirname(dirname(publicEntry));
    if (publicEntry !== join(root, 'dist/index.js')) throw new Error('Unsupported adjacent Pi entry');
    piAt(root);
  }
  if (!fs.statSync(entry).isFile()) throw new Error('Shell entry missing');
  const probe = spawnSync(node, ['--version'], { encoding: 'utf8', timeout: 2000 });
  if (probe.status !== 0) throw new Error(`Cannot probe Node: ${node}`);
  return { entry, node };
}
function guardCheckoutPackages() {
  for (const [base, path] of [[join(prefix, 'agent'), join(prefix, 'agent/settings.json')],
    [join(process.cwd(), '.pi'), join(process.cwd(), '.pi/settings.json')]]) {
    try {
      if (!stat(path)) continue;
      if (!stat(path).isFile()) throw new Error('Settings must be a regular file');
      const settings = json(path);
      if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
          (Object.hasOwn(settings, 'packages') && !Array.isArray(settings.packages))) throw new Error('Invalid packages');
      for (const entry of settings.packages ?? []) {
        const source = typeof entry === 'string' ? entry : entry?.source;
        if (typeof source !== 'string' || !source.trim()) throw new Error('Invalid source');
        // The existing helper deliberately skips git. Refuse recognizable Shell
        // URLs without inventing a git resolver; unrelated git packages still load.
        if (packageSourceKind(source) === 'git' && /gentle(?:-shell|-pi)(?:[/.#@]|$)/i.test(source)) {
          throw new Error('Gentle Shell git source requires manual review');
        }
        const declaration = findGentlePiDeclaration(JSON.stringify({ packages: [entry] }), {
          agentDir: base, readPackageName: dir => json(join(dir, 'package.json')).name,
        });
        if (declaration && (declaration.kind !== 'path' ||
            fs.realpathSync(declaration.dir) !== fs.realpathSync(checkout))) throw new Error('Competing Gentle Shell');
      }
    } catch {
      throw new Error(`Cannot safely launch checkout: review packages in ${path}; remove competing Gentle Shell declarations or use this checkout's canonical path. Settings unchanged.`);
    }
  }
}
async function launch(args = []) {
  guardCheckoutPackages(); // Before even offering dependency preparation.
  let selected;
  try { selected = runtime('checkout'); }
  catch (error) {
    if (error.code !== 'CHECKOUT_PI_MISSING') throw error;
    console.log(`\n\n  ${paint('38;2;127;180;202', 'Prepare checkout')}\n`);
    console.log(paint('2', '  Checkout is not prepared: missing @earendil-works/pi-coding-agent.\n' +
      '  Run in this checkout:'));
    console.log('    pnpm install --frozen-lockfile\n');
    console.log(`  ${paint('33', 'Warning:')} ${paint('2', 'this may download dependencies and run install scripts')}\n` +
      paint('2', '  with side effects; it is not sandboxed.\n' +
      '  The bundled release is not updated by this launcher.') + '\n');
    const answer = await ask('  Prepare checkout now? [y/N]: ');
    if (!/^(y|yes)$/i.test(answer ?? '')) throw error;
    closeInput(); // Installer, then Pi, own stdin; never reopen the menu.
    let pnpm;
    for (const dir of (process.env.PATH ?? '').split(':')) {
      const path = resolve(dir, 'pnpm');
      try {
        fs.accessSync(path, fs.constants.X_OK);
        if (fs.statSync(path).isFile()) { pnpm = path; break; }
      } catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error; }
    }
    if (!pnpm) throw new Error('  pnpm is unavailable. Install the pnpm version declared in\n' +
      '  package.json (packageManager), then retry.\n' +
      '  The launcher does not install Node or pnpm.');
    const code = await runChild(pnpm, ['install', '--frozen-lockfile'], { cwd: checkout });
    if (code !== 0) { process.exitCode = code; return; }
    selected = runtime('checkout', true); // A failed revalidation never asks again.
  }
  closeInput(); // The launched TUI, not this menu, must own terminal input.
  guardCheckoutPackages(); // Install lifecycle scripts may have changed settings.
  validateConfig();
  runtime('release'); // Never mark a baseline without a valid installed release.
  const saved = reference();
  if (!saved) {
    const ref = capture('release reference');
    atomic(referencePath, JSON.stringify({ schema: 1, ...ref }) + '\n');
    console.log(paint('32', `Release reference saved: ${ref.backup}`));
  }
  console.log('Shared agent data: ~/.gentle-shell/agent. Do not run versions concurrently.');
  const env = { ...process.env, PI_CODING_AGENT_DIR: join(prefix, 'agent'),
    // --link prioritizes USER_PI_HOME over PI_CODING_AGENT_DIR in nested sessions.
    GENTLE_SHELL_USER_PI_HOME: join(prefix, 'agent'), GENTLE_PI_AGENT_HOME: join(prefix, 'agent'),
    GENTLE_PI_CONFIG_HOME: config, GENTLE_SHELL_CONFIG_HOME: config,
    PI_SKIP_VERSION_CHECK: '1' };
  for (const key of ['GENTLE_SHELL_PI', 'GENTLE_SHELL_HOME', 'GENTLE_SHELL_PREFIX', 'GENTLE_SHELL_CONFIG']) delete env[key];
  process.exitCode = await runChild(selected.node, [selected.entry, '--link', ...args], { env });
}
async function runChild(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: 'inherit' });
  const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => {
    const handler = () => child.kill(signal); process.on(signal, handler); return [signal, handler];
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 128 + (osConstants.signals[signal] ?? 0) : code ?? 1));
  }).finally(() => { for (const [signal, handler] of handlers) process.removeListener(signal, handler); });
}
let input, answers;
function closeInput() { input?.close(); }
async function ask(prompt) {
  if (!input) {
    input = createInterface({ input: process.stdin, output: process.stdout });
    answers = input[Symbol.asyncIterator]();
  }
  process.stdout.write(prompt);
  const answer = await answers.next();
  return answer.done ? null : answer.value.trim();
}
async function recover() {
  let saved = reference();
  if (!saved) throw new Error('No release reference; launch checkout first');
  validateConfig();
  console.log('  Recover trusted pre-checkout configuration; close other instances first.');
  for (const name of allowlist) console.log(`    ${name} (${saved.files[name] === null ? 'remove if present' : 'restore'})`);
  const answer = await ask('  Type yes to recover: ');
  if (answer === null) throw new Error('Input ended before an answer');
  if (answer !== 'yes') throw new Error('Recovery cancelled');
  // Revalidate ALL source and destination paths before snapshotting or changing
  // any config. No concurrency promise: close other instances before recovery.
  saved = reference();
  if (!saved) throw new Error('Missing release reference; refusing to recover');
  validateConfig();
  const before = capture('before recovery');
  for (const name of allowlist) {
    const target = join(prefix, name), record = saved.files[name];
    if (record !== null) atomic(target, Buffer.from(record.data, 'base64'));
    else { safe(target); if (stat(target)) fs.unlinkSync(target); }
  }
  console.log(paint('32', `Recovered release configuration. Safety backup: ${before.backup}`));
}
async function main() {
  let [command, ...args] = process.argv.slice(2);
  if (!command) {
    let status;
    try {
      const ref = reference();
      status = ref ? `trusted pre-checkout state saved ${ref.createdAt}` : 'not saved (captured before first checkout)';
    } catch (error) { status = `unavailable (${error.message})`; }
    console.log(`\n  ${paint('38;2;127;180;202', 'Gentle Shell · local development')}\n`);
    console.log(paint('2', `  Shared agent: ${join(prefix, 'agent')}`));
    console.log(paint('2', `  Release reference: ${status}`));
    console.log(`\n  ${paint('38;2;127;180;202', '1) Launch checkout [default Enter]')}\n  ${paint('33', '2) Recover release configuration')}\n  0) Exit\n`);
    const choice = await ask('  Choice: ');
    if (choice === null || choice === '0') return;
    command = { '': 'checkout', 1: 'checkout', 2: 'recover' }[choice];
  }
  if (args.length && !(command === 'checkout' && args[0] === '--')) throw new Error('Invalid arguments; use --help');
  if (command === '--help') return console.log(help.trimEnd());
  if (command === 'recover') return recover();
  if (command === 'checkout') {
    const forwarded = args.slice(1);
    const parsed = parseLauncherArgs(['--link', ...forwarded]);
    if (parsed.error || parsed.home !== undefined || parsed.isolated || parsed.packageRoot !== undefined) {
      throw new Error('Checkout arguments cannot override --home, --isolated or --package-root');
    }
    return launch(forwarded);
  }
  throw new Error('Unknown command; use --help');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closeInput);
