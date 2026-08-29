import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	GLOBAL_SCOPE_KEY,
	getRegistryPath,
	parseRegistry,
	PROFILES_KEY,
	selectScopedMcpConfig,
} from "../src/registry.ts";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "scoped-mcp-"));
	const project = join(root, "project");
	const nestedProject = join(project, "packages", "nested");
	const child = join(nestedProject, "src");
	const outside = join(root, "outside");
	mkdirSync(child, { recursive: true });
	mkdirSync(outside);
	return { root, project, nestedProject, child, outside };
}

test("uses a consistently named config in Pi's extensions directory", () => {
	const agentDir = join(tmpdir(), "custom-pi-agent");

	assert.equal(
		getRegistryPath({ PI_CODING_AGENT_DIR: agentDir }),
		join(agentDir, "extensions", "scoped-mcp", "scoped-mcp.json"),
	);
});

test("supports an explicitly configured scoped-mcp path", () => {
	const configPath = join(tmpdir(), "custom-scoped-mcp.json");

	assert.equal(
		getRegistryPath({ PI_SCOPED_MCP_CONFIG: configPath }),
		configPath,
	);
});

test("loads global MCPs outside configured project paths", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: { global: { command: "global-command" } },
		},
		project: {
			path: paths.project,
			mcpServers: { phpstorm: { command: "phpstorm-command" } },
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.outside);

	assert.deepEqual(selected.config.mcpServers, {
		global: { command: "global-command" },
	});
	assert.equal(selected.projectName, undefined);
});

test("does not activate profiles outside a project that references them", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: { global: { command: "global-command" } },
		},
		[PROFILES_KEY]: {
			reusable: {
				mcpServers: { profiled: { command: "profile-command" } },
			},
		},
		project: { path: paths.project, profiles: ["reusable"] },
	});

	const selected = selectScopedMcpConfig(registry, paths.outside);

	assert.deepEqual(selected.profileNames, []);
	assert.deepEqual(selected.config.mcpServers, {
		global: { command: "global-command" },
	});
});

test("merges global MCPs with the matching project", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: { global: { command: "global-command" } },
			settings: { idleTimeout: 10 },
		},
		project: {
			path: paths.project,
			mcpServers: {
				phpstorm: { command: "phpstorm-command", toolPrefix: "mcp" },
			},
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.child);

	assert.equal(selected.projectName, "project");
	assert.deepEqual(selected.config, {
		mcpServers: {
			global: { command: "global-command" },
			phpstorm: { command: "phpstorm-command", toolPrefix: "mcp" },
		},
		settings: {
			idleTimeout: 10,
		},
	});
});

test("merges global, ordered profiles, and project configuration", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: {
				shared: {
					url: "https://global.invalid/mcp",
					headers: { Authorization: "global-secret" },
				},
			},
			settings: { idleTimeout: 10, scriptMode: false },
		},
		[PROFILES_KEY]: {
			php: {
				mcpServers: {
					phpstorm: { command: "phpstorm-command" },
					shared: { toolPrefix: "none" },
				},
				settings: { idleTimeout: 20 },
			},
			trusted: {
				mcpServers: { shared: { samplingAutoApprove: true } },
			},
		},
		project: {
			path: paths.project,
			profiles: ["php", "trusted"],
			mcpServers: { shared: { disabled: true } },
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.project);

	assert.deepEqual(selected.profileNames, ["php", "trusted"]);
	assert.deepEqual(selected.config, {
		mcpServers: {
			shared: {
				url: "https://global.invalid/mcp",
				headers: { Authorization: "global-secret" },
				toolPrefix: "none",
				samplingAutoApprove: true,
				disabled: true,
			},
			phpstorm: { command: "phpstorm-command" },
		},
		settings: { idleTimeout: 20, scriptMode: false },
	});
	assert.equal(selected.serverOrigins.phpstorm, "profile php");
	assert.equal(selected.serverOrigins.shared, "project override");
});

test("applies profiles in listed order and lets the project replace them", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[PROFILES_KEY]: {
			first: { mcpServers: { server: { command: "first" } } },
			second: { mcpServers: { server: { command: "second" } } },
		},
		project: {
			path: paths.project,
			profiles: ["first", "second"],
			mcpServers: { server: { command: "project" } },
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.project);

	assert.deepEqual(selected.config.mcpServers.server, { command: "project" });
	assert.equal(selected.serverOrigins.server, "project");
});

test("profile server definitions completely replace inherited connection details", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: {
				server: {
					url: "https://global.invalid/mcp",
					headers: { Authorization: "global-secret" },
				},
			},
		},
		[PROFILES_KEY]: {
			local: {
				mcpServers: { server: { command: "local-command" } },
			},
		},
		project: { path: paths.project, profiles: ["local"] },
	});

	assert.deepEqual(
		selectScopedMcpConfig(registry, paths.project).config.mcpServers.server,
		{ command: "local-command" },
	);
});

test("rejects invalid or unknown profile references", () => {
	const paths = fixture();

	assert.throws(
		() =>
			parseRegistry({
				project: { path: paths.project, profiles: ["missing"] },
			}),
		/references unknown profile "missing"/,
	);
	assert.throws(
		() =>
			parseRegistry({
				[PROFILES_KEY]: { shared: {} },
				project: {
					path: paths.project,
					profiles: ["shared", "shared"],
				},
			}),
		/must not contain duplicates/,
	);
});

test("profiles cannot select paths or extend other profiles", () => {
	const paths = fixture();

	assert.throws(
		() =>
			parseRegistry({
				[PROFILES_KEY]: {
					invalid: { path: paths.project },
				},
			}),
		/must not define "path" or "profiles"/,
	);
	assert.throws(
		() =>
			parseRegistry({
				[PROFILES_KEY]: {
					invalid: { profiles: ["another"] },
				},
			}),
		/must not define "path" or "profiles"/,
	);
});

test("inherits per-server prefixes through disabled-only project overrides", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: {
				shared: {
					command: "shared-command",
					toolPrefix: "none",
				},
			},
		},
		project: {
			path: paths.project,
			mcpServers: { shared: { disabled: true } },
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.project);

	assert.deepEqual(selected.config.mcpServers.shared, {
		command: "shared-command",
		toolPrefix: "none",
		disabled: true,
	});
	assert.equal(selected.config.settings, undefined);
});

test("project can override an inherited server prefix without copying its definition", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: {
				shared: {
					url: "https://global.invalid/mcp",
					headers: { Authorization: "global-secret" },
					toolPrefix: "mcp",
				},
			},
		},
		project: {
			path: paths.project,
			mcpServers: { shared: { toolPrefix: "none" } },
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.project);

	assert.deepEqual(selected.config.mcpServers.shared, {
		url: "https://global.invalid/mcp",
		headers: { Authorization: "global-secret" },
		toolPrefix: "none",
	});
	assert.equal(selected.config.settings, undefined);
});

test("keeps per-server sampling trust scoped to its server", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: {
				trusted: {
					command: "trusted-command",
					samplingAutoApprove: true,
				},
				untrusted: { command: "untrusted-command" },
			},
		},
		project: {
			path: paths.project,
			mcpServers: { trusted: { samplingAutoApprove: false } },
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.project);

	assert.deepEqual(selected.config.mcpServers.trusted, {
		command: "trusted-command",
		samplingAutoApprove: false,
	});
	assert.deepEqual(selected.config.mcpServers.untrusted, {
		command: "untrusted-command",
	});
	assert.equal(selected.config.settings?.samplingAutoApprove, undefined);
});

test("rejects root-level toolPrefix settings", () => {
	assert.throws(
		() =>
			parseRegistry({
				[GLOBAL_SCOPE_KEY]: {
					settings: { toolPrefix: "none" },
				},
			}),
		/set toolPrefix on each MCP server instead/,
	);
});

test("rejects invalid per-server toolPrefix values", () => {
	assert.throws(
		() =>
			parseRegistry({
				[GLOBAL_SCOPE_KEY]: {
					mcpServers: {
						server: { command: "server-command", toolPrefix: "custom" },
					},
				},
			}),
		/must be "server", "short", "none", or "mcp"/,
	);
});

test("rejects invalid per-server samplingAutoApprove values", () => {
	assert.throws(
		() =>
			parseRegistry({
				[GLOBAL_SCOPE_KEY]: {
					mcpServers: {
						server: {
							command: "server-command",
							samplingAutoApprove: "yes",
						},
					},
				},
			}),
		/must be true or false/,
	);
});

test("chooses the deepest matching project path", () => {
	const paths = fixture();
	const registry = parseRegistry({
		parent: {
			path: paths.project,
			mcpServers: { server: { command: "parent" } },
		},
		nested: {
			path: paths.nestedProject,
			mcpServers: { server: { command: "nested" } },
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.child);

	assert.equal(selected.projectName, "nested");
	assert.equal(selected.projectPath, realpathSync.native(paths.nestedProject));
	assert.equal(selected.config.mcpServers.server?.command, "nested");
});

test("project server definitions replace same-named global definitions", () => {
	const paths = fixture();
	const registry = parseRegistry({
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: {
				phpstorm: {
					url: "https://global.invalid/mcp",
					headers: { Authorization: "global-secret" },
					toolPrefix: "mcp",
				},
			},
		},
		project: {
			path: paths.project,
			mcpServers: {
				phpstorm: {
					url: "https://project.invalid/mcp",
				},
			},
		},
	});

	const selected = selectScopedMcpConfig(registry, paths.project);

	assert.deepEqual(selected.config.mcpServers.phpstorm, {
		url: "https://project.invalid/mcp",
	});
	assert.equal(selected.config.settings, undefined);
});

test("rejects project scopes without a path", () => {
	assert.throws(
		() =>
			parseRegistry({
				project: {
					mcpServers: {},
				},
			}),
		/must define an absolute "path"/,
	);
});

test("rejects relative project paths", () => {
	const registry = parseRegistry({
		project: {
			path: "./project",
			mcpServers: {},
		},
	});

	assert.throws(
		() => selectScopedMcpConfig(registry, process.cwd()),
		/must be absolute/,
	);
});
