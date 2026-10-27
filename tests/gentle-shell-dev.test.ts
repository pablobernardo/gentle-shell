import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

type Fixture = ReturnType<typeof fixture>;

const source = resolve('scripts/gentle-shell-dev.mjs');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const missingPi = (f: Fixture) => '  Checkout is not prepared: missing @earendil-works/pi-coding-agent.\n' +
  '  Prepare this checkout, then retry the launcher:\n' +
  `    cd ${quote(f.repo)}\n    pnpm install --frozen-lockfile\n` +
  '    node scripts/gentle-shell-dev.mjs\n';
const preparation = '\n\n  Prepare checkout\n\n' +
  '  Checkout is not prepared: missing @earendil-works/pi-coding-agent.\n' +
  '  Run in this checkout:\n' +
  '    pnpm install --frozen-lockfile\n\n' +
  '  Warning: this may download dependencies and run install scripts\n' +
  '  with side effects; it is not sandboxed.\n' +
  '  The bundled release is not updated by this launcher.\n\n' +
  '  Prepare checkout now? [y/N]: ';
function fixture(t: TestContext, { pnpm = false, checkoutName = 'checkout' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'gentle-dev-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const repo = join(root, checkoutName);
  const prefix = join(home, '.gentle-shell');
  const manager = join(prefix, 'dev-launcher');
  function put(path: string, text: string | Uint8Array) {
    fs.mkdirSync(join(path, '..'), { recursive: true });
    fs.writeFileSync(path, text);
  }
  put(join(repo, 'scripts/gentle-shell-dev.mjs'), fs.readFileSync(source));
  fs.cpSync(resolve('runtime'), join(repo, 'runtime'), { recursive: true });
  put(join(repo, 'package.json'), JSON.stringify({ name: 'gentle-pi', version: 'dev' }));
  const child = `
    console.log(JSON.stringify({ args: process.argv.slice(2), node: process.execPath,
      agent: process.env.PI_CODING_AGENT_DIR, config: process.env.GENTLE_PI_CONFIG_HOME }));
    process.exit(Number(process.env.CHILD_CODE || 0));
  `;
  put(join(repo, 'bin/gentle-shell.mjs'), child);
  const pi = join(repo, 'node_modules/@earendil-works/pi-coding-agent');
  put(join(pi, 'package.json'), JSON.stringify({
    name: '@earendil-works/pi-coding-agent', version: '1.2.0',
    exports: { '.': { import: './dist/index.js' } }, bin: { pi: 'dist/bundle/cli.js' },
  }));
  put(join(pi, 'dist/index.js'), '');
  put(join(pi, 'dist/bundle/cli.js'), '');
  const release = join(prefix, 'versions/4.0.0');
  put(join(release, '.gentle-shell-version'), '4.0.0\n');
  put(join(release, 'package.json'), JSON.stringify({ dependencies: {
    'gentle-pi': '4.0.0', '@earendil-works/pi-coding-agent': '1.2.0',
  } }));
  const shellRoot = join(release, pnpm
    ? 'node_modules/.pnpm/gentle-pi@4.0.0/node_modules/gentle-pi' : 'node_modules/gentle-pi');
  const piRoot = join(release, pnpm
    ? 'node_modules/.pnpm/@earendil-works+pi-coding-agent@1.2.0/node_modules/@earendil-works/pi-coding-agent'
    : 'node_modules/@earendil-works/pi-coding-agent');
  put(join(shellRoot, 'package.json'), JSON.stringify({ name: 'gentle-pi', version: '4.0.0' }));
  put(join(shellRoot, 'bin/gentle-shell.mjs'), child);
  put(join(piRoot, 'package.json'), fs.readFileSync(join(pi, 'package.json')));
  put(join(piRoot, 'dist/bundle/cli.js'), '');
  if (pnpm) {
    fs.mkdirSync(join(release, 'node_modules/@earendil-works'), { recursive: true });
    fs.symlinkSync('.pnpm/gentle-pi@4.0.0/node_modules/gentle-pi', join(release, 'node_modules/gentle-pi'));
    fs.symlinkSync('../.pnpm/@earendil-works+pi-coding-agent@1.2.0/node_modules/@earendil-works/pi-coding-agent',
      join(release, 'node_modules/@earendil-works/pi-coding-agent'));
  }
  fs.symlinkSync('versions/4.0.0', join(prefix, 'current'));
  put(join(prefix, 'bin/gentle-shell'), `#!/bin/sh\nexec '${process.execPath}' '${join(prefix, 'current/node_modules/gentle-pi/bin/gentle-shell.mjs')}' "$@"\n`);
  fs.chmodSync(join(prefix, 'bin/gentle-shell'), 0o700);
  put(join(prefix, 'agent/settings.json'), '{"theme":"Gentle"}\n');
  put(join(prefix, 'config/gentle-ai/vim.json'), '{"enabled":true}');
  const run = (args: string[], input = '', env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath,
    [join(repo, 'scripts/gentle-shell-dev.mjs'), ...args], {
      cwd: repo, encoding: 'utf8', input, timeout: 5000,
      env: { HOME: home, TMPDIR: root, PATH: process.env.PATH, ...env },
    });
  const backups = () => fs.existsSync(join(manager, 'backups'))
    ? fs.readdirSync(join(manager, 'backups')) : [];
  const snapshot = (id: string) => JSON.parse(fs.readFileSync(join(manager, 'backups', id, 'snapshot.json'), 'utf8'));
  const reference = () => JSON.parse(fs.readFileSync(join(manager, 'release-reference.json'), 'utf8'));
  function tree() {
    return JSON.stringify(fs.readdirSync(prefix, { recursive: true, encoding: 'utf8' })
      .filter(p => !p.includes('node_modules')).map(p => {
        const path = join(prefix, p), s = fs.lstatSync(path);
        const value = s.isFile() ? fs.readFileSync(path, 'base64')
          : s.isSymbolicLink() ? fs.readlinkSync(path) : 'dir';
        return [p, value];
      }));
  }
  return { run, prefix, repo, manager, backups, snapshot, reference, put, tree, root };
}
function ok(result: SpawnSyncReturns<string>) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
}
function rejected(f: Fixture, args: string[], error: RegExp, input = 'yes\n') {
  const before = f.tree();
  const result = f.run(args, input);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, error);
  assert.equal(f.tree(), before);
}
const referencePath = (f: Fixture) => join(f.manager, 'release-reference.json');
const snapshotPath = (f: Fixture, id: string) => join(f.manager, 'backups', id, 'snapshot.json');
const menu = (f: Fixture, reference = 'not saved (captured before first checkout)') =>
  `\n  Gentle Shell · local development\n\n  Shared agent: ${join(f.prefix, 'agent')}\n` +
  `  Release reference: ${reference}\n\n  1) Launch checkout [default Enter]\n` +
  '  2) Recover release configuration\n  0) Exit\n\n  Choice: ';
const warning = 'Shared agent data: ~/.gentle-shell/agent. Do not run versions concurrently.\n';
const confirm = '  Type yes to recover: ';
const recoveryIntro = (f: Fixture) => {
  const saved = f.snapshot(f.reference().backup);
  return '  Recover trusted pre-checkout configuration; close other instances first.\n' +
    Object.entries(saved.files).map(([name, entry]) => `    ${name} (${entry === null ? 'remove if present' : 'restore'})\n`).join('') + confirm;
};

test('missing checkout Pi gives preparation instructions before any mutation', t => {
  for (const missing of ['package', 'node_modules']) {
    const f = fixture(t, { checkoutName: "checkout with space and 'quote" });
    fs.rmSync(join(f.repo, missing === 'package'
      ? 'node_modules/@earendil-works/pi-coding-agent' : 'node_modules'), { recursive: true });
    const before = f.tree();
    const expected = missingPi(f);
    for (const [args, input, stdout] of ([[['checkout'], '', ''], [[], '\n', menu(f)]] satisfies [string[], string, string][])) {
      const result = f.run(args, input);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, stdout + preparation);
      assert.equal(result.stderr, expected);
      assert.equal(f.tree(), before);
      assert.equal(fs.existsSync(f.manager), false);
      assert.equal(f.backups().length, 0);
    }
    const help = f.run(['--help']);
    ok(help);
    assert.match(help.stdout, /Node >=22\.19\.0/);
    assert.match(help.stdout, /packageManager/);
    assert.match(help.stdout, /pnpm install --frozen-lockfile/);
    for (const input of ['0\n', '']) {
      const exit = f.run([], input);
      ok(exit);
      assert.equal(exit.stdout, menu(f));
    }
    rejected(f, ['recover'], /^No release reference; launch checkout first\n$/);
    assert.equal(f.tree(), before);
  }
});

test('preparation colors are TTY-only, respect even empty NO_COLOR, and keep warning indentation', t => {
  const available = spawnSync('python3', ['-c', 'import pty, termios'], { encoding: 'utf8' });
  if (available.status !== 0) return t.skip('Python PTY support unavailable');
  const f = fixture(t), fake = fakePnpm(f), before = f.tree();
  for (const noColor of [null, '', '1']) {
    const result = spawnSync('python3', ['-c', `
import errno, json, os, pty, select, subprocess, sys, termios, time
master, slave = pty.openpty()
attrs = termios.tcgetattr(slave)
attrs[3] &= ~termios.ECHO
termios.tcsetattr(slave, termios.TCSANOW, attrs)
env = json.loads(sys.argv[3])
p = subprocess.Popen([sys.argv[1], sys.argv[2], 'checkout'], stdin=slave, stdout=slave, stderr=subprocess.PIPE, env=env)
os.close(slave)
data = b''
sent = False
deadline = time.monotonic() + 4
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as e:
                if e.errno == errno.EIO: break
                raise
            if not chunk: break
            data += chunk
            if not sent and b'Prepare checkout now? [y/N]: ' in data:
                os.write(master, b'n\\n')
                sent = True
    if p.poll() is None: p.kill()
    _, errors = p.communicate(timeout=1)
    print(json.dumps({'status': p.returncode, 'stdout': data.decode().replace('\\r\\n', '\\n'), 'stderr': errors.decode(), 'sent': sent}))
finally:
    os.close(master)
` , process.execPath, join(f.repo, 'scripts/gentle-shell-dev.mjs'), JSON.stringify({
      HOME: join(f.root, 'home'), PATH: fake.env.PATH, TERM: 'xterm-256color',
      ...(noColor === null ? {} : { NO_COLOR: noColor }),
    })], { encoding: 'utf8', timeout: 6000 });
    ok(result);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.status, 1);
    assert.equal(observed.sent, true);
    // Readline echoes the typed answer in a terminal (unlike piped stdin).
    assert.equal(observed.stdout.replace(/\x1b\[[0-9;]*m/g, '').replaceAll('\r\n', '\n'), preparation + 'n\n');
    assert.match(observed.stderr, /^  Checkout is not prepared:/);
    assert.doesNotMatch(observed.stderr, /\x1b/);
    if (noColor === null) {
      assert.match(observed.stdout, /  \x1b\[38;2;127;180;202mPrepare checkout/);
      assert.match(observed.stdout, /  \x1b\[33mWarning:\x1b\[0m \x1b\[2mthis may download/);
    } else assert.equal(observed.stdout.replaceAll('\r\n', '\n'), preparation + 'n\n');
    assert.equal(fake.count(), '');
    assert.equal(f.tree(), before);
  }
  for (const noColor of [undefined, '', '1']) {
    const result = f.run(['checkout'], 'n\n', { ...fake.env,
      ...(noColor === undefined ? {} : { NO_COLOR: noColor }) });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, preparation);
    assert.doesNotMatch(result.stderr, /\x1b/);
    assert.equal(fake.count(), '');
    assert.equal(f.tree(), before);
  }
});

function fakePnpm(f: Fixture, mode = 'success') {
  const pi = join(f.repo, 'node_modules/@earendil-works/pi-coding-agent');
  const metadata = fs.readFileSync(join(pi, 'package.json'), 'utf8');
  fs.rmSync(join(f.repo, 'node_modules'), { recursive: true });
  const tools = join(f.root, 'tools'), counter = join(f.root, 'pnpm-count');
  f.put(join(tools, 'pnpm'), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${join(tools, 'fake-pnpm.cjs').replaceAll("'", "'\\''")}' "$@"\n`);
  f.put(join(tools, 'fake-pnpm.cjs'), `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    assert.equal(process.cwd(), ${JSON.stringify(f.repo)});
    assert.deepEqual(process.argv.slice(2), ['install', '--frozen-lockfile']);
    assert.equal(process.env.TOOLCHAIN_SENTINEL, 'kept');
    fs.appendFileSync(${JSON.stringify(counter)}, '1');
    console.log('fake install stdout'); console.error('fake install stderr');
    if (${JSON.stringify(mode)} === 'failure') process.exit(37);
    if (${JSON.stringify(mode)} === 'signal') process.kill(process.pid, 'SIGTERM');
    if (${JSON.stringify(mode)} === 'success' || ${JSON.stringify(mode)} === 'broken') {
      const pi = ${JSON.stringify(pi)};
      fs.mkdirSync(pi + '/dist/bundle', { recursive: true });
      fs.writeFileSync(pi + '/package.json', ${JSON.stringify(metadata)});
      fs.writeFileSync(pi + '/dist/index.js', '');
      if (${JSON.stringify(mode)} === 'success') fs.writeFileSync(pi + '/dist/bundle/cli.js', '');
    }
  `);
  fs.chmodSync(join(tools, 'pnpm'), 0o700);
  return { env: { PATH: tools, TOOLCHAIN_SENTINEL: 'kept' }, counter,
    count: () => fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8') : '' };
}
const installLogs = 'fake install stdout\n';
const installErrors = 'fake install stderr\n';

test('explicit preparation succeeds directly and with queued menu answers; revalidates in the same process', t => {
  for (const [args, input] of ([[['checkout'], 'y\n'], [[], '1\nyes\n'], [[], '\nYES\n'], [['checkout'], 'Y\n']] satisfies [string[], string][])) {
    const f = fixture(t), fake = fakePnpm(f), before = f.tree();
    const result = f.run(args, input, fake.env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, installErrors);
    const child = { args: ['--link'], node: fs.realpathSync(process.execPath),
      agent: join(f.prefix, 'agent'), config: join(f.prefix, 'config/gentle-ai') };
    assert.equal(result.stdout, (args.length ? '' : menu(f)) + preparation + installLogs +
      `Release reference saved: ${f.reference().backup}\n` + warning + JSON.stringify(child) + '\n');
    assert.equal(fake.count(), '1');
    assert.equal(f.backups().length, 1);
    assert.notEqual(f.tree(), before);
    const pointer = fs.readFileSync(referencePath(f));
    ok(f.run(['checkout'], '', fake.env));
    assert.equal(fake.count(), '1');
    assert.deepEqual(fs.readFileSync(referencePath(f)), pointer);
  }
});

test('blank, no, EOF and other preparation answers do not invoke pnpm or mutate home', t => {
  for (const answer of ['', '\n', 'n\n', 'no\n', 'NO\n', 'sure\n', 'yes please\n']) {
    const f = fixture(t);
    ok(f.run(['checkout']));
    const fake = fakePnpm(f), before = f.tree();
    const result = f.run(['checkout'], answer, fake.env);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, preparation);
    assert.equal(result.stderr, missingPi(f));
    assert.equal(fake.count(), '');
    assert.equal(f.tree(), before);
  }
});

test('missing pnpm reports prerequisite without installation or state changes', t => {
  const f = fixture(t), fake = fakePnpm(f), before = f.tree();
  const result = f.run(['checkout'], 'yes\n', { ...fake.env, PATH: join(f.root, 'no-tools') });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, preparation);
  assert.equal(result.stderr, '  pnpm is unavailable. Install the pnpm version declared in\n' +
    '  package.json (packageManager), then retry.\n' +
    '  The launcher does not install Node or pnpm.\n');
  assert.equal(fake.count(), '');
  assert.equal(f.tree(), before);
});

test('installer failure and signal propagate logs and status without launch or saved-state changes', t => {
  for (const [mode, code] of ([['failure', 37], ['signal', 143]] satisfies [string, number][])) {
    const f = fixture(t);
    ok(f.run(['checkout']));
    const fake = fakePnpm(f, mode), before = f.tree();
    const result = f.run(['checkout'], 'yes\n', fake.env);
    assert.equal(result.status, code);
    assert.equal(result.stdout, preparation + installLogs);
    assert.equal(result.stderr, installErrors);
    assert.equal(fake.count(), '1');
    assert.equal(f.tree(), before);
  }
});

test('successful installer with missing or broken Pi fails fresh validation without prompting again', t => {
  for (const mode of ['missing', 'broken']) {
    const f = fixture(t), fake = fakePnpm(f, mode), before = f.tree();
    const result = f.run(['checkout'], 'yes\nyes\n', fake.env);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, preparation + installLogs);
    if (mode === 'missing') assert.equal(result.stderr, installErrors + missingPi(f));
    else assert.match(result.stderr, /^fake install stderr\nENOENT:.*cli\.js'\n$/);
    assert.equal(fake.count(), '1');
    assert.equal(f.tree(), before);
    assert.equal(f.backups().length, 0);
  }
});

test('broken checkout Pi retains its own diagnostic rather than installation advice', t => {
  for (const kind of ['json', 'metadata', 'export', 'entry', 'cli']) {
    const f = fixture(t), pi = join(f.repo, 'node_modules/@earendil-works/pi-coding-agent');
    const meta = JSON.parse(fs.readFileSync(join(pi, 'package.json'), 'utf8'));
    if (kind === 'json') f.put(join(pi, 'package.json'), '{');
    if (kind === 'metadata') f.put(join(pi, 'package.json'), JSON.stringify({ ...meta, name: 'not-pi' }));
    if (kind === 'export') f.put(join(pi, 'package.json'), JSON.stringify({ ...meta, exports: {} }));
    if (kind === 'entry') fs.unlinkSync(join(pi, 'dist/index.js'));
    if (kind === 'cli') fs.unlinkSync(join(pi, 'dist/bundle/cli.js'));
    const before = f.tree(), result = f.run(['checkout']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, kind === 'json' ? /Invalid package config/ : kind === 'metadata'
      ? /^Unsupported Pi metadata\n$/ : kind === 'export' ? /No "exports" main defined/ : /ENOENT/);
    assert.doesNotMatch(result.stderr, /not prepared|pnpm install/);
    assert.equal(f.tree(), before);
    assert.equal(f.backups().length, 0);
  }
});

test('recovery remains available without checkout dependencies', t => {
  const f = fixture(t);
  ok(f.run(['checkout']));
  fs.rmSync(join(f.repo, 'node_modules'), { recursive: true });
  f.put(join(f.prefix, 'agent/settings.json'), 'changed');
  const before = f.tree(), intro = recoveryIntro(f);
  const cancelled = f.run(['recover'], 'no\n');
  assert.equal(cancelled.status, 1);
  assert.equal(cancelled.stdout, intro);
  assert.equal(cancelled.stderr, 'Recovery cancelled\n');
  assert.equal(f.tree(), before);
  const recovered = f.run(['recover'], 'yes\n');
  ok(recovered);
  const safety = f.backups().find(id => id !== f.reference().backup);
  assert.equal(recovered.stdout, intro + `Recovered release configuration. Safety backup: ${safety}\n`);
  assert.equal(f.backups().length, 2);
  assert.equal(fs.readFileSync(join(f.prefix, 'agent/settings.json'), 'utf8'), '{"theme":"Gentle"}\n');
});

test('macOS metadata is not a backup: menu, initial checkout and recovery leave it unchanged', t => {
  const f = fixture(t);
  const sentinel = join(f.manager, 'backups/.DS_Store');
  f.put(sentinel, 'Finder metadata sentinel');
  f.put(join(f.manager, 'backups/unrelated/snapshot.json'), 'not owned JSON');
  const before = f.tree(), exit = f.run([], '0\n');
  ok(exit);
  assert.equal(exit.stdout, menu(f));
  assert.equal(f.tree(), before);
  ok(f.run(['checkout']));
  const pointer = fs.readFileSync(referencePath(f));
  f.put(join(f.prefix, 'agent/settings.json'), '{"theme":"changed"}');
  ok(f.run(['checkout']));
  ok(f.run(['recover'], 'yes\n'));
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'Finder metadata sentinel');
  assert.equal(fs.readFileSync(join(f.manager, 'backups/unrelated/snapshot.json'), 'utf8'), 'not owned JSON');
  assert.deepEqual(fs.readFileSync(referencePath(f)), pointer);
  assert.equal(fs.readFileSync(join(f.prefix, 'agent/settings.json'), 'utf8'), '{"theme":"Gentle"}\n');
  assert.equal(f.backups().length, 4);
});

test('owned UUID backup entries still fail closed without replacing a baseline', t => {
  for (const kind of ['symlink', 'invalid', 'marked']) {
    const f = fixture(t), id = '11111111-1111-1111-1111-111111111111';
    if (kind === 'symlink') {
      f.put(join(f.manager, 'backups/unrelated/snapshot.json'), '{}');
      fs.symlinkSync('unrelated', join(f.manager, 'backups', id));
    } else f.put(snapshotPath(f, id), kind === 'invalid' ? '{' : '{"reason":"release reference"}');
    for (const cmd of ['checkout', 'recover']) rejected(f, [cmd], kind === 'symlink'
      ? /^Unsafe path:/ : kind === 'invalid' ? /^Cannot read JSON/ : /^Missing release reference; refusing to replace it\n$/);
  }
});

test('bundled release rejects invalid markers, metadata, wrong version entries and escaped packages', t => {
  for (const kind of ['marker', 'shell-version', 'shell-name', 'pi-version', 'wrong-entry', 'outside-current', 'outside-shell', 'outside-pi']) {
    const f = fixture(t, { pnpm: true });
    const release = join(f.prefix, 'versions/4.0.0');
    const shell = fs.realpathSync(join(release, 'node_modules/gentle-pi'));
    const pi = fs.realpathSync(join(release, 'node_modules/@earendil-works/pi-coding-agent'));
    if (kind === 'marker') f.put(join(release, '.gentle-shell-version'), 'installing 4.0.0 123\n');
    if (kind === 'shell-version' || kind === 'shell-name') f.put(join(shell, 'package.json'),
      JSON.stringify({ name: kind === 'shell-name' ? 'other' : 'gentle-pi', version: '5.0.0' }));
    if (kind === 'pi-version') f.put(join(pi, 'package.json'), JSON.stringify({
      ...JSON.parse(fs.readFileSync(join(pi, 'package.json'), 'utf8')), version: '9.0.0',
    }));
    if (kind === 'wrong-entry') {
      const other = join(f.prefix, 'versions/other/bin/gentle-shell.mjs');
      f.put(other, '');
      f.put(join(f.prefix, 'bin/gentle-shell'), `#!/bin/sh\nexec '${process.execPath}' '${other}' "$@"\n`);
    }
    if (kind === 'outside-current') {
      fs.unlinkSync(join(f.prefix, 'current'));
      fs.symlinkSync(f.repo, join(f.prefix, 'current'));
      f.put(join(f.prefix, 'bin/gentle-shell'), `#!/bin/sh\nexec '${process.execPath}' '${join(f.repo, 'bin/gentle-shell.mjs')}' "$@"\n`);
    }
    if (kind === 'outside-shell' || kind === 'outside-pi') {
      const name = kind === 'outside-shell' ? 'gentle-pi' : '@earendil-works/pi-coding-agent';
      const link = join(release, 'node_modules', name);
      const outside = join(f.repo, 'escaped-package');
      fs.cpSync(kind === 'outside-shell' ? shell : pi, outside, { recursive: true });
      fs.unlinkSync(link);
      fs.symlinkSync(outside, link);
    }
    rejected(f, ['checkout'], /^Invalid bundled release\n$/);
  }
});

test('generated pnpm-style bundled release permits checkout and immutable reference', t => {
  const f = fixture(t, { pnpm: true });
  ok(f.run(['checkout']));
  const pointer = fs.readFileSync(referencePath(f));
  ok(f.run(['checkout']));
  assert.deepEqual(fs.readFileSync(referencePath(f)), pointer);
  assert.equal(f.backups().length, 1);
});

test('help and exit are read-only; superseded commands and extra arguments reject', t => {
  const f = fixture(t), before = f.tree();
  const help = f.run(['--help']);
  ok(help);
  assert.match(help.stdout, /recover/);
  assert.match(help.stdout, /default Enter/);
  assert.doesNotMatch(help.stdout, /restore <|\n  info|\n  backups|\n  release /);
  for (const command of ['release', 'info', 'backups', 'restore', 'upgrade']) {
    rejected(f, [command], /^Unknown command; use --help\n$/);
  }
  for (const command of ['release', 'checkout', 'recover', '--help']) {
    rejected(f, [command, 'extra'], /^Invalid arguments; use --help\n$/);
  }
  const exit = f.run([], '0\n', { NO_COLOR: '1' });
  ok(exit);
  assert.equal(exit.stdout, menu(f));
  assert.equal(f.tree(), before);
});

test('checkout forwards arguments after -- unchanged and preserves reference and child status', t => {
  const f = fixture(t);
  for (const args of [['-r'], ['--resume', 'session with spaces.jsonl'], ['--model', 'provider/model', 'a prompt; $(not a shell)'], []]) {
    const beforeSettings = fs.readFileSync(join(f.prefix, 'agent/settings.json'));
    const result = f.run(['checkout', '--', ...args], '', { CHILD_CODE: '17' });
    assert.equal(result.status, 17);
    assert.equal(result.stderr, '');
    const child = { args: ['--link', ...args], node: fs.realpathSync(process.execPath),
      agent: join(f.prefix, 'agent'), config: join(f.prefix, 'config/gentle-ai') };
    const ref = f.reference();
    assert.equal(result.stdout, (args[0] === '-r' ? `Release reference saved: ${ref.backup}\n` : '') + warning + JSON.stringify(child) + '\n');
    assert.deepEqual(fs.readFileSync(join(f.prefix, 'agent/settings.json')), beforeSettings);
    assert.equal(f.backups().length, 1);
  }
});

test('forwarding is checkout-only and cannot override shared home or checkout package', t => {
  const f = fixture(t), before = f.tree();
  for (const flag of ['--home', '--home=/elsewhere', '--isolated', '--package-root', '--package-root=/elsewhere']) {
    const result = f.run(['checkout', '--', flag, '/elsewhere'], 'yes\n');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Checkout arguments cannot override --home, --isolated or --package-root\n');
    assert.equal(f.tree(), before);
    assert.equal(fs.existsSync(f.manager), false);
  }
  for (const command of ['recover', '--help', 'checkout']) {
    const args = command === 'checkout' ? [command, '-r'] : [command, '--', '-r'];
    const result = f.run(args, 'yes\n');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Invalid arguments; use --help\n');
    assert.equal(f.tree(), before);
  }
});

test('Enter defaults to checkout; EOF exits without launching or writing', t => {
  const f = fixture(t), before = f.tree();
  const eof = f.run([]);
  ok(eof);
  assert.equal(eof.stdout, menu(f));
  assert.equal(f.tree(), before);
  const launched = f.run([], '\n', { CHILD_CODE: '17' });
  assert.equal(launched.status, 17);
  assert.equal(launched.stderr, '');
  const child = { args: ['--link'], node: fs.realpathSync(process.execPath),
    agent: join(f.prefix, 'agent'), config: join(f.prefix, 'config/gentle-ai') };
  assert.equal(launched.stdout, menu(f) + `Release reference saved: ${f.reference().backup}\n` + warning + JSON.stringify(child) + '\n');
  assert.equal(f.backups().length, 1);
});

test('checkout captures immutable marked reference; repeated launches never promote configuration', t => {
  const f = fixture(t);
  const first = f.run(['checkout']);
  ok(first);
  const ref = f.reference(), saved = fs.readFileSync(snapshotPath(f, ref.backup));
  assert.match(ref.createdAt, /^\d{4}-\d\d-\d\dT/);
  const child = { args: ['--link'], node: fs.realpathSync(process.execPath),
    agent: join(f.prefix, 'agent'), config: join(f.prefix, 'config/gentle-ai') };
  assert.equal(first.stdout, `Release reference saved: ${ref.backup}\n` + warning + JSON.stringify(child) + '\n');
  assert.equal(f.backups().length, 1);
  f.put(join(f.prefix, 'agent/settings.json'), '{"theme":"development changes"}');
  const pointer = fs.readFileSync(referencePath(f));
  for (let i = 0; i < 3; i++) ok(f.run(['checkout']));
  assert.equal(f.backups().length, 1);
  assert.deepEqual(fs.readFileSync(referencePath(f)), pointer);
  assert.deepEqual(fs.readFileSync(snapshotPath(f, ref.backup)), saved);
  const status = f.run([], '0\n');
  ok(status);
  assert.equal(status.stdout, menu(f, `trusted pre-checkout state saved ${ref.createdAt}`));
  const failed = f.run(['checkout'], '', { CHILD_CODE: '17' });
  assert.equal(failed.status, 17);
  assert.equal(failed.stderr, '');
  assert.equal(f.backups().length, 1);
});

test('checkout validates release and checkout before capturing; generic backups are never adopted', t => {
  const f = fixture(t);
  const launcher = join(f.prefix, 'bin/gentle-shell'), original = fs.readFileSync(launcher);
  f.put(launcher, '#!/bin/sh\nexit 0\n');
  rejected(f, ['checkout'], /^Unsupported bundled launcher; expected the generated POSIX launcher\n$/);
  f.put(launcher, original);
  const metadata = join(f.repo, 'node_modules/@earendil-works/pi-coding-agent/package.json');
  const originalMetadata = fs.readFileSync(metadata);
  f.put(metadata, JSON.stringify({ ...JSON.parse(originalMetadata.toString('utf8')), name: 'not-pi' }));
  rejected(f, ['checkout'], /^Unsupported Pi metadata\n$/);
  f.put(metadata, originalMetadata);
  const oldId = '11111111-1111-1111-1111-111111111111';
  const old = '{"schema":1,"reason":"before checkout","files":{}}';
  f.put(snapshotPath(f, oldId), old);
  ok(f.run(['checkout']));
  assert.notEqual(f.reference().backup, oldId);
  assert.equal(fs.readFileSync(snapshotPath(f, oldId), 'utf8'), old);
  assert.equal(f.backups().length, 2);
});

test('recover restores whole reference, removes absent allowlisted files and preserves auth/sessions', t => {
  const f = fixture(t);
  ok(f.run(['checkout']));
  const ref = f.reference(), pointer = fs.readFileSync(referencePath(f));
  f.put(join(f.prefix, 'agent/settings.json'), 'changed');
  f.put(join(f.prefix, 'config/gentle-ai/animations.json'), 'added');
  f.put(join(f.prefix, 'agent/auth.json'), 'credential fixture');
  f.put(join(f.prefix, 'agent/sessions/session.json'), 'session fixture');
  f.put(join(f.prefix, 'config/gentle-ai/unlisted.json'), 'untouched');
  const intro = recoveryIntro(f);
  const yes = f.run(['recover'], 'yes\n');
  ok(yes);
  assert.equal(f.backups().length, 2);
  const safety = f.backups().find(id => id !== ref.backup);
  assert.equal(yes.stdout, intro + `Recovered release configuration. Safety backup: ${safety}\n`);
  assert.equal(fs.readFileSync(join(f.prefix, 'agent/settings.json'), 'utf8'), '{"theme":"Gentle"}\n');
  assert.equal(fs.readFileSync(join(f.prefix, 'config/gentle-ai/vim.json'), 'utf8'), '{"enabled":true}');
  assert.equal(fs.existsSync(join(f.prefix, 'config/gentle-ai/animations.json')), false);
  assert.equal(fs.readFileSync(join(f.prefix, 'agent/auth.json'), 'utf8'), 'credential fixture');
  assert.equal(fs.readFileSync(join(f.prefix, 'agent/sessions/session.json'), 'utf8'), 'session fixture');
  assert.equal(fs.readFileSync(join(f.prefix, 'config/gentle-ai/unlisted.json'), 'utf8'), 'untouched');
  assert.equal(Buffer.from(f.snapshot(safety).files['agent/settings.json'].data, 'base64').toString(), 'changed');
  assert.equal(Buffer.from(f.snapshot(safety).files['config/gentle-ai/animations.json'].data, 'base64').toString(), 'added');
  assert.deepEqual(fs.readFileSync(referencePath(f)), pointer);
  if (process.platform !== 'win32') {
    for (const path of [f.manager, join(f.manager, 'backups'), join(f.manager, 'backups', ref.backup)]) {
      assert.equal(fs.statSync(path).mode & 0o777, 0o700);
    }
    for (const path of [referencePath(f), snapshotPath(f, ref.backup), join(f.prefix, 'agent/settings.json')]) {
      assert.equal(fs.statSync(path).mode & 0o777, 0o600);
    }
  }
});

test('queued menu recovery confirms in order; cancellation and EOF leave all data unchanged', t => {
  const f = fixture(t);
  ok(f.run(['checkout']));
  f.put(join(f.prefix, 'agent/settings.json'), 'changed');
  const ref = f.reference();
  const prefix = menu(f, `trusted pre-checkout state saved ${ref.createdAt}`) + recoveryIntro(f);
  for (const [input, error] of [['2\nno\n', 'Recovery cancelled\n'], ['2\n', 'Input ended before an answer\n']]) {
    const before = f.tree(), result = f.run([], input);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, error);
    assert.equal(result.stdout, prefix);
    assert.equal(f.tree(), before);
  }
  const yes = f.run([], '2\nyes\n');
  ok(yes);
  const safety = f.backups().find(id => id !== ref.backup);
  assert.equal(yes.stdout, prefix + `Recovered release configuration. Safety backup: ${safety}\n`);
  assert.equal(fs.readFileSync(join(f.prefix, 'agent/settings.json'), 'utf8'), '{"theme":"Gentle"}\n');
  const launched = f.run([], '1\n', { CHILD_CODE: '23' });
  assert.equal(launched.status, 23);
  assert.equal(launched.stderr, '');
  assert.equal(f.backups().length, 2);
});

test('corrupt or missing reference and payload reject checkout and recovery without writes', t => {
  const f = fixture(t);
  rejected(f, ['recover'], /^No release reference; launch checkout first\n$/);
  ok(f.run(['checkout']));
  const ref = f.reference(), path = snapshotPath(f, ref.backup);
  const original = fs.readFileSync(path), pointer = fs.readFileSync(referencePath(f));
  for (const bad of ['{', JSON.stringify({ ...JSON.parse(original.toString('utf8')), files: {} }),
    JSON.stringify({ ...JSON.parse(original.toString('utf8')), files: { ...JSON.parse(original.toString('utf8')).files,
      'agent/settings.json': { data: 'dGFtcGVy', sha256: '0'.repeat(64) } } })]) {
    f.put(path, bad);
    for (const cmd of ['checkout', 'recover']) rejected(f, [cmd], /reference|integrity|JSON/);
  }
  f.put(path, original);
  for (const bad of ['{', JSON.stringify({ ...ref, backup: '../escape' })]) {
    f.put(referencePath(f), bad);
    for (const cmd of ['checkout', 'recover']) rejected(f, [cmd], /reference|Invalid|JSON/);
  }
  f.put(referencePath(f), pointer);
  fs.unlinkSync(referencePath(f));
  for (const cmd of ['checkout', 'recover']) rejected(f, [cmd], /^Missing release reference; refusing to replace it\n$/);
  f.put(referencePath(f), pointer);
  fs.unlinkSync(path);
  for (const cmd of ['checkout', 'recover']) rejected(f, [cmd], /Cannot read JSON/);
});

test('late allowlist directories and symlink ancestors reject before any recovery changes', t => {
  const f = fixture(t);
  ok(f.run(['checkout']));
  f.put(join(f.prefix, 'agent/settings.json'), '{"theme":"must not change"}');
  const late = join(f.prefix, 'config/gentle-ai/builtin-codemode-optout.json');
  fs.mkdirSync(late);
  rejected(f, ['recover'], /^Unsafe path:/);
  fs.rmdirSync(late);
  fs.symlinkSync('missing', late);
  for (const cmd of ['recover', 'checkout']) rejected(f, [cmd], /^Unsafe path:/);
  fs.unlinkSync(late);
  fs.renameSync(join(f.prefix, 'config'), join(f.prefix, 'other-config'));
  fs.symlinkSync('other-config', join(f.prefix, 'config'));
  for (const cmd of ['recover', 'checkout']) rejected(f, [cmd], /^Unsafe path:/);
});

test('manager and source symlinks reject without writes', t => {
  const f = fixture(t);
  fs.symlinkSync('config', f.manager);
  rejected(f, ['checkout'], /^Unsafe path:/);
  fs.unlinkSync(f.manager);
  ok(f.run(['checkout']));
  const path = snapshotPath(f, f.reference().backup);
  fs.renameSync(path, `${path}.original`);
  fs.symlinkSync('snapshot.json.original', path);
  for (const cmd of ['checkout', 'recover']) rejected(f, [cmd], /^Unsafe path:/);
});

test('conflicts and ambiguous settings refuse before preparation, backup or launch', t => {
  for (const kind of ['npm', 'path', 'later', 'project', 'malformed', 'shape', 'entry', 'git']) {
    for (const prepared of [true, false]) {
      const f = fixture(t), fake = prepared ? { env: {}, count: () => '' } : fakePnpm(f);
      const other = join(f.root, 'other');
      f.put(join(other, 'package.json'), '{"name":"gentle-pi"}');
      const path = kind === 'project' ? join(f.repo, '.pi/settings.json') : join(f.prefix, 'agent/settings.json');
      const packages = kind === 'path' ? [other] : kind === 'later' ? [f.repo, { source: 'npm:gentle-pi@4' }]
        : kind === 'git' ? ['git:github.com/Gentleman-Programming/gentle-shell']
        : kind === 'entry' ? [{}] : ['npm:gentle-pi'];
      f.put(path, kind === 'malformed' ? '{' : JSON.stringify(kind === 'shape' ? { packages: {} } : { packages }));
      const before = f.tree(), project = fs.readFileSync(path);
      const result = f.run(['checkout'], 'yes\n', fake.env);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `Cannot safely launch checkout: review packages in ${path}; remove competing Gentle Shell declarations or use this checkout's canonical path. Settings unchanged.\n`);
      assert.equal(fake.count(), '');
      assert.equal(f.tree(), before);
      assert.deepEqual(fs.readFileSync(path), project);
      assert.equal(f.backups().length, 0);
    }
  }
});

test('postinstall configuration conflict stops before reference or launch (installer side effects remain)', t => {
  const f = fixture(t), fake = fakePnpm(f);
  const installer = join(f.root, 'tools/fake-pnpm.cjs');
  const settings = join(f.prefix, 'agent/settings.json');
  f.put(installer, fs.readFileSync(installer, 'utf8') + `\nfs.writeFileSync(${JSON.stringify(settings)}, '{"packages":["npm:gentle-pi"]}');`);
  const result = f.run(['checkout'], 'yes\n', fake.env);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, preparation + installLogs);
  assert.equal(result.stderr, installErrors + `Cannot safely launch checkout: review packages in ${settings}; remove competing Gentle Shell declarations or use this checkout's canonical path. Settings unchanged.\n`);
  assert.equal(fake.count(), '1');
  assert.equal(fs.existsSync(f.manager), false);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{"packages":["npm:gentle-pi"]}');
});

test('same checkout aliases and unrelated packages are accepted without settings writes', t => {
  const f = fixture(t), alias = join(f.root, 'alias');
  fs.symlinkSync(f.repo, alias);
  const path = join(f.prefix, 'agent/settings.json');
  const settings = JSON.stringify({ packages: ['npm:unrelated', { source: alias }] });
  f.put(path, settings);
  ok(f.run(['checkout']));
  assert.equal(fs.readFileSync(path, 'utf8'), settings);
});

test('actual launcher ignores inherited home/runtime selectors and selects this checkout', t => {
  const f = fixture(t);
  for (const dir of ['bin', 'runtime', 'scripts']) fs.cpSync(resolve(dir), join(f.repo, dir), { recursive: true });
  const outer = join(f.prefix, 'outer-agent');
  f.put(join(outer, 'settings.json'), '{"theme":"outer"}');
  f.put(join(f.repo, 'package.json'), JSON.stringify({ name: 'gentle-pi', version: 'dev', pi: { extensions: [] } }));
  f.put(join(f.repo, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'), `
    if (process.argv.includes('--version')) console.log('1.2.0');
    else {
      const { spawnSync } = await import('node:child_process');
      const probe = spawnSync(process.execPath, ['--experimental-strip-types', ${JSON.stringify(resolve('tests/gentle-shell-dev-native.test.ts'))},
        '--native-probe', JSON.stringify({ args: process.argv.slice(2) })], {
        cwd: process.cwd(), env: { ...process.env, PI_OFFLINE: '1' }, encoding: 'utf8' });
      if (probe.status !== 0) throw new Error(probe.stderr);
      console.log(JSON.stringify({ ...JSON.parse(probe.stdout), agent: process.env.PI_CODING_AGENT_DIR,
      userHome: process.env.GENTLE_SHELL_USER_PI_HOME,
      gentleHome: process.env.GENTLE_PI_AGENT_HOME,
      config: process.env.GENTLE_PI_CONFIG_HOME }));
    }
  `);
  const result = f.run(['checkout'], '', {
    PI_CODING_AGENT_DIR: outer, GENTLE_SHELL_USER_PI_HOME: outer,
    GENTLE_PI_AGENT_HOME: outer, GENTLE_SHELL_HOME: outer,
    GENTLE_SHELL_PI: join(outer, 'missing-pi'), GENTLE_SHELL_PREFIX: outer,
    GENTLE_SHELL_CONFIG: join(outer, 'config.json'),
    GENTLE_SHELL_CONFIG_HOME: outer, GENTLE_PI_CONFIG_HOME: outer,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const shared = join(f.prefix, 'agent');
  assert.equal(result.stdout, `Release reference saved: ${f.reference().backup}\n` + warning +
    JSON.stringify({ errors: [], mcp: true, agent: shared, userHome: shared, gentleHome: shared,
      config: join(f.prefix, 'config/gentle-ai') }) + '\n');
  assert.equal(fs.readFileSync(join(outer, 'settings.json'), 'utf8'), '{"theme":"outer"}');
  assert.equal(fs.readFileSync(join(shared, 'settings.json'), 'utf8'), '{"theme":"Gentle"}\n');
  const settings = JSON.stringify({ packages: [f.repo] });
  f.put(join(shared, 'settings.json'), settings);
  const configured = f.run(['checkout']);
  ok(configured);
  assert.equal(JSON.parse(configured.stdout.trim().split('\n').at(-1)).mcp, true);
  assert.equal(fs.readFileSync(join(shared, 'settings.json'), 'utf8'), settings);
  assert.equal(f.backups().length, 1);
});
