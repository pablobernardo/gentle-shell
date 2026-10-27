# Local development launcher
Standalone macOS-only launcher for testing the checkout with the installed release's shared sessions and sign-ins.
Branch: `feat/local-dev-launcher`. Delivery: one cohesive commit and branch push to the personal fork; no PR or upstream publication.

## Specs
S1. Keep the executable in `scripts/gentle-shell-dev.mjs`, with a small styled menu: checkout by default, recovery and exit. Launch the release normally with `gentle-shell`.
S2. Share the agent/config homes. Save one immutable trusted pre-checkout configuration reference; require confirmation and a safety snapshot before recovery. Preserve sessions, credentials and excluded files.
S3. Offer frozen-lockfile dependency preparation only for missing checkout Pi, with explicit default-No consent and lifecycle-script warnings. Do not bootstrap tools, upgrade Pi or update the installed release.
S4. Use normal native loading with `--link`; preserve MCP preferences and trust decisions. Refuse competing or ambiguous declarations before preparation and before backup/launch, without editing settings.
S5. Forward native arguments through `checkout --`, preserving argument boundaries and child status. Reject native home/package selectors before side effects.
S6. Keep tests as `.test.ts`, included by the existing unit-test selection. Keep documentation in English, with conclusions rather than dialogue or implementation history.

## Tasks
T1 [S1-S6] implementation and focused verification, done: launcher, recovery, preparation, argument forwarding, native loading, TypeScript tests and usage guide. Commit: the feature commit containing this document (resolve with `git log -- odd/tasks/local-dev-launcher.md`).
T2 [S1-S6] complete-project validation, deferred by explicit decision: earlier suite failure remains unresolved; no automatic retry. Commit: none.

## Verification
- Launcher tests: 28/28 passed; native loader tests: 9/9 passed, no skips.
- Focused TypeScript check and active LSP checks for both test files passed.
- Independent checks covered recovery safety, shared homes, native MCP/trust behavior, conflict refusal and argument forwarding. Five differential sibling-command checks passed for forwarding.
- Both tests match the existing `tests/*.test.ts` selection. See the [usage guide](../../docs/gentle-shell-dev.md) for the focused command.
- Complete-project validation remains pending after an earlier `pnpm test` failure; no broad-suite or global typecheck retry is authorized.
- Native assessment of the staged five-file candidate returned medium risk with `reviewDue: false`; no native review was required. Earlier untracked-candidate assessments were unavailable.
- Isolated fixtures were used; live session selection, configured MCP server connectivity and real-home recovery were not verified. A manual launch was reported working.

## Log
- Keep this development script macOS-only; leave unrelated project Windows support unchanged.
- Use the checkout's local Pi without forced takeover or builtin overrides; do not change release files, preferences or dependency versions.
- The configuration reference is trusted initial state, not proof of release provenance. Recovery is atomic per file, not transactional; close concurrent instances first.
- A single cohesive commit is accepted despite exceeding the usual review-line budget: code, tests and guide form one feature. Further global validation, PR creation or upstream publication requires a separate decision.
