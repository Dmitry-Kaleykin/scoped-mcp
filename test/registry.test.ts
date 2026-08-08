import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	GLOBAL_SCOPE_KEY,
	parseRegistry,
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
			phpstorm: { command: "phpstorm-command" },
		},
		settings: {
			idleTimeout: 10,
			toolPrefix: { phpstorm: "mcp" },
		},
	});
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
		disabled: true,
	});
	assert.deepEqual(selected.config.settings?.toolPrefix, { shared: "none" });
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
	});
	assert.deepEqual(selected.config.settings?.toolPrefix, { shared: "none" });
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
