# Run Gentle Shell from your checkout

**macOS only.** The checkout and installed release share sessions, sign-ins and
configuration under `~/.gentle-shell/agent` and `~/.gentle-shell/config/gentle-ai`.
**Close other instances before switching or recovering:** concurrency is not detected.

## Start

Use Node >=22.19.0 and the pnpm version declared in `package.json`:

```sh
pnpm install --frozen-lockfile
node scripts/gentle-shell-dev.mjs
```

No `make install` or global installation is needed. The menu offers **1 / Enter**
to launch checkout, **2** to recover configuration and **0** to exit. EOF exits.
Launch the installed release normally with `gentle-shell`.

Direct commands: `checkout`, `recover` and `--help`. Help, menu, exit and recovery
work without checkout Pi. Checkout launch requires a valid installed release and
uses the checkout's local Pi; it does not upgrade Pi or fall back to release Pi.

If local Pi is missing, the script offers preparation. Only **y/yes** consents;
all other answers decline. Preparation runs `pnpm install --frozen-lockfile` in the
checkout. **Downloads and lifecycle scripts are not sandboxed and can access your
files/environment.** Node and pnpm must already be installed. Failure stops before
launch or reference writes; success revalidates Pi before continuing.

## Resume sessions and pass arguments

Arguments after `checkout --` go to Gentle Shell without opening the menu:

```sh
node scripts/gentle-shell-dev.mjs checkout -- -r
```

For a convenient alias, replace `/path/to/checkout` with your absolute checkout path:

```sh
alias gentle-dev='node "/path/to/checkout/scripts/gentle-shell-dev.mjs" checkout --'
gentle-dev -r
```

The current directory and argument boundaries are preserved. Only `checkout`
accepts forwarding; `checkout -- --help` requests native help. Native home/package
selectors (`--home`, `--isolated`, `--package-root`) are rejected before preparation
or backup, including `--home=<path>` and `--package-root=<path>`. A further native
`--` ends launcher-option parsing. An empty `checkout --` is equivalent to `checkout`.

## Loading conflicts

Normal native loading preserves MCP settings and project trust decisions; the
script does not force builtin extensions or edit settings. Before preparation and
again before backup/launch, it checks shared-agent and cwd `.pi/settings.json` for
competing Gentle Shell declarations. Canonical same-checkout aliases are allowed;
conflicts, recognizable Gentle Shell/Pi git sources and ambiguous configuration
require manual review. Errors identify the settings file. Even an untrusted
project conflict may block launch; arbitrary aliases/renamed forks are not detected.
Refusal does not install, launch or change the reference; a consented install's
own side effects remain possible before rechecking.

## Reference and recovery

Before first checkout launch, the script saves allowlisted configuration under
`~/.gentle-shell/dev-launcher/backups`, with pointer `release-reference.json` in
`~/.gentle-shell/dev-launcher`. Start from configuration you trust: this is
**trusted pre-checkout state, not proof of release provenance**. Later launches
never replace it, including after release use. There is no recapture command;
do not delete the pointer to reset it. Corrupt references and unsafe paths block
launch/recovery rather than creating a replacement.

Run `node scripts/gentle-shell-dev.mjs recover`, review the listed files and type
exactly **yes**. Recovery first saves a safety snapshot, then restores saved files
and removes allowlisted regular files that were absent at capture. It never
deletes directories or changes the reference pointer.

Eligible files: `agent/settings.json` and
`config/gentle-ai/{persona,background-subagents,subagents,profiles,permission-mode,vim,animations,notifications,history-capture,visual-profiles,visual-customization,builtin-codemode-optout}.json`.
Sessions, auth, models/MCP configuration, packages, runtimes and native review
authority remain untouched. Symlinks, nonregular files and invalid checksums are rejected.

Backups are **private, not encrypted or redacted**; do not share them. Directories
are 0700 and files 0600. Recovery writes are atomic **per file**, not transactional:
a filesystem failure can leave partial recovery. The safety snapshot remains,
but there is no automatic rollback. Backups are not automatically pruned.

## Tests

Both tests match the repository's default `tests/*.test.ts` unit-test selection:

```sh
node --experimental-strip-types --test tests/gentle-shell-dev.test.ts tests/gentle-shell-dev-native.test.ts
```
