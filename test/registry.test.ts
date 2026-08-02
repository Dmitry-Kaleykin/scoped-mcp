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
			mcpServers: { phpstorm: { command: "phpstorm-command" } },
			settings: { toolPrefix: "mcp" },
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
			toolPrefix: "mcp",
		},
	});
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
