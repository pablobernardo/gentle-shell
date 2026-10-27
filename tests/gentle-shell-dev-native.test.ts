import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

type Scenario = {
	args?: string[];
	trusted?: boolean;
	global?: string[];
	project?: string[];
};

// Use the actual adjacent Pi's public loader in an isolated process, not a
// session: register /mcp without reading server config, connecting or inference.
if (process.argv[2] === "--native-probe") {
	const { DefaultResourceLoader, SettingsManager, createMcpExtension, parseArgs } = await import("@earendil-works/pi-coding-agent");
	const root = process.cwd();
	const scenario: Scenario = JSON.parse(process.argv[3]);
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	assert.ok(agentDir, "Native probe requires an isolated agent directory");
	const parsed = parseArgs(scenario.args ?? []);
	const settingsManager = SettingsManager.create(root, agentDir, { projectTrusted: scenario.trusted ?? false });
	const loader = new DefaultResourceLoader({
		cwd: root, agentDir, settingsManager,
		additionalExtensionPaths: parsed.extensions, noExtensions: parsed.noExtensions,
		disabledBuiltinExtensions: parsed.noMcp ? ["mcp"] : [],
		extensionFactories: [{ name: "mcp", builtin: true, replaceable: true, factory: createMcpExtension({
			loadConfig: () => { throw new Error("No MCP config may be read by this probe"); },
			createTransport: () => { throw new Error("No server may connect in this probe"); },
		}) }],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await loader.reload();
	const loaded = loader.getExtensions();
	process.stdout.write(JSON.stringify({ errors: loaded.errors, mcp: loaded.extensions.some((extension) => extension.commands.has("mcp")) }) + "\n");
} else {
	function probe(t: TestContext, scenario: Scenario) {
		const root = mkdtempSync(join(tmpdir(), "gentle-shell-native-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		for (const dir of ["home", "agent", "tmp", ".pi"]) mkdirSync(join(root, dir));
		writeFileSync(join(root, "agent", "settings.json"), JSON.stringify({ extensions: scenario.global ?? [] }));
		writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ extensions: scenario.project ?? [] }));
		const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), "--native-probe", JSON.stringify(scenario)], {
			cwd: root, encoding: "utf8", timeout: 10000,
			env: { HOME: join(root, "home"), USERPROFILE: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "agent"), TMPDIR: join(root, "tmp"), PI_OFFLINE: "1", PATH: "" },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
		const output = JSON.parse(result.stdout);
		assert.deepEqual(output.errors, []);
		return output.mcp;
	}

	for (const [name, scenario, expected] of [
		["default MCP", {}, true],
		["global disabled", { global: ["-builtin:mcp"] }, false],
		["trusted project disabled", { trusted: true, project: ["-builtin:mcp"] }, false],
		["untrusted project cannot reenable global disabled", { global: ["-builtin:mcp"], project: ["+builtin:mcp"] }, false],
		["trusted project can reenable global disabled", { trusted: true, global: ["-builtin:mcp"], project: ["+builtin:mcp"] }, true],
		["--no-mcp", { args: ["--no-mcp"] }, false],
		["--no-extensions", { args: ["--no-extensions"] }, false],
		["-ne", { args: ["-ne"] }, false],
		["explicit CLI builtin overrides settings exclusion", { global: ["-builtin:mcp"], args: ["-e", "builtin:mcp"] }, true],
	] satisfies [string, Scenario, boolean][]) {
		test(`normal loading: ${name}`, (t) => assert.equal(probe(t, scenario), expected));
	}
}
