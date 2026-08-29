import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatScopedMcpStatus } from "../src/commands.ts";
import {
	GLOBAL_SCOPE_KEY,
	getRegistryProfiles,
	PROFILES_KEY,
	readScopedMcpRegistry,
	selectScopedMcpConfig,
	setServerDisabled,
	writeScopedMcpRegistry,
} from "../src/registry.ts";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "scoped-mcp-commands-"));
	const project = join(root, "project");
	const outside = join(root, "outside");
	const registryPath = join(root, "scoped-mcp.json");
	mkdirSync(project);
	mkdirSync(outside);
	writeScopedMcpRegistry(registryPath, {
		[GLOBAL_SCOPE_KEY]: {
			mcpServers: {
				global: { command: "global-command" },
				shared: { command: "shared-command" },
			},
		},
		project: {
			path: project,
			mcpServers: {
				project: { command: "project-command", directTools: true },
			},
		},
	});
	return { outside, project, registryPath };
}

test("default toggle updates a project-owned server and persists it", () => {
	const paths = fixture();

	const result = setServerDisabled({
		cwd: paths.project,
		disabled: true,
		registryPath: paths.registryPath,
		serverName: "project",
	});

	assert.equal(result.scopeName, "project");
	assert.equal(result.changed, true);
	assert.equal(
		readScopedMcpRegistry(paths.registryPath).project?.mcpServers?.project
			?.disabled,
		true,
	);
});

test("default toggle updates a global server when the project does not own it", () => {
	const paths = fixture();

	const result = setServerDisabled({
		cwd: paths.project,
		disabled: true,
		registryPath: paths.registryPath,
		serverName: "global",
	});

	assert.equal(result.scopeName, GLOBAL_SCOPE_KEY);
	assert.equal(
		readScopedMcpRegistry(paths.registryPath)[GLOBAL_SCOPE_KEY]?.mcpServers
			?.global?.disabled,
		true,
	);
});

test("default toggle updates a profile-owned server", () => {
	const paths = fixture();
	const registry = readScopedMcpRegistry(paths.registryPath);
	registry[PROFILES_KEY] = {
		reusable: {
			mcpServers: { profiled: { command: "profile-command" } },
		},
	};
	(registry.project as { profiles?: string[] }).profiles = ["reusable"];
	writeScopedMcpRegistry(paths.registryPath, registry);

	const result = setServerDisabled({
		cwd: paths.project,
		disabled: true,
		registryPath: paths.registryPath,
		serverName: "profiled",
	});

	assert.equal(result.scopeName, "profile reusable");
	assert.equal(
		getRegistryProfiles(readScopedMcpRegistry(paths.registryPath)).reusable
			?.mcpServers?.profiled?.disabled,
		true,
	);
});

test("--project can locally override a profile-owned server", () => {
	const paths = fixture();
	const registry = readScopedMcpRegistry(paths.registryPath);
	registry[PROFILES_KEY] = {
		reusable: {
			mcpServers: { profiled: { command: "profile-command" } },
		},
	};
	(registry.project as { profiles?: string[] }).profiles = ["reusable"];
	writeScopedMcpRegistry(paths.registryPath, registry);

	setServerDisabled({
		cwd: paths.project,
		disabled: true,
		registryPath: paths.registryPath,
		serverName: "profiled",
		target: "project",
	});

	let updated = readScopedMcpRegistry(paths.registryPath);
	assert.deepEqual(updated.project?.mcpServers?.profiled, { disabled: true });
	assert.equal(
		getRegistryProfiles(updated).reusable?.mcpServers?.profiled?.disabled,
		undefined,
	);

	setServerDisabled({
		cwd: paths.project,
		disabled: false,
		registryPath: paths.registryPath,
		serverName: "profiled",
		target: "project",
	});

	updated = readScopedMcpRegistry(paths.registryPath);
	assert.equal(updated.project?.mcpServers?.profiled, undefined);
});

test("--project can disable and re-enable an inherited global server", () => {
	const paths = fixture();

	setServerDisabled({
		cwd: paths.project,
		disabled: true,
		registryPath: paths.registryPath,
		serverName: "shared",
		target: "project",
	});

	let registry = readScopedMcpRegistry(paths.registryPath);
	assert.deepEqual(registry.project?.mcpServers?.shared, { disabled: true });
	assert.equal(
		selectScopedMcpConfig(registry, paths.project).config.mcpServers.shared
			?.disabled,
		true,
	);

	setServerDisabled({
		cwd: paths.project,
		disabled: false,
		registryPath: paths.registryPath,
		serverName: "shared",
		target: "project",
	});

	registry = readScopedMcpRegistry(paths.registryPath);
	assert.equal(registry.project?.mcpServers?.shared, undefined);
	assert.equal(
		selectScopedMcpConfig(registry, paths.project).config.mcpServers.shared
			?.disabled,
		undefined,
	);
});

test("--project can enable a globally disabled server", () => {
	const paths = fixture();
	const registry = readScopedMcpRegistry(paths.registryPath);
	const shared = registry[GLOBAL_SCOPE_KEY]?.mcpServers?.shared;
	assert.ok(shared);
	shared.disabled = true;
	writeScopedMcpRegistry(paths.registryPath, registry);

	setServerDisabled({
		cwd: paths.project,
		disabled: false,
		registryPath: paths.registryPath,
		serverName: "shared",
		target: "project",
	});

	const updated = readScopedMcpRegistry(paths.registryPath);
	assert.deepEqual(updated.project?.mcpServers?.shared, { disabled: false });
	assert.equal(
		selectScopedMcpConfig(updated, paths.project).config.mcpServers.shared
			?.disabled,
		false,
	);
});

test("project toggles preserve an inherited server's prefix override", () => {
	const paths = fixture();
	const registry = readScopedMcpRegistry(paths.registryPath);
	const projectScope = registry.project;
	assert.ok(projectScope);
	projectScope.mcpServers ??= {};
	projectScope.mcpServers.shared = { toolPrefix: "none" };
	writeScopedMcpRegistry(paths.registryPath, registry);

	setServerDisabled({
		cwd: paths.project,
		disabled: true,
		registryPath: paths.registryPath,
		serverName: "shared",
		target: "project",
	});
	assert.deepEqual(
		readScopedMcpRegistry(paths.registryPath).project?.mcpServers?.shared,
		{ toolPrefix: "none", disabled: true },
	);

	setServerDisabled({
		cwd: paths.project,
		disabled: false,
		registryPath: paths.registryPath,
		serverName: "shared",
		target: "project",
	});
	assert.deepEqual(
		readScopedMcpRegistry(paths.registryPath).project?.mcpServers?.shared,
		{ toolPrefix: "none" },
	);
});

test("status reports registry, scope, origin, state, and direct mode", () => {
	const paths = fixture();
	const status = formatScopedMcpStatus(paths.project, {
		PI_SCOPED_MCP_CONFIG: paths.registryPath,
	});

	assert.match(status, new RegExp(`Registry: ${paths.registryPath}`));
	assert.match(status, /Scope: project/);
	assert.match(status, /global: enabled, proxy, prefix: server, scope: \$global/);
	assert.match(
		status,
		/project: enabled, direct: all, prefix: server, scope: project/,
	);
});

test("status reports active profiles and profile server origins", () => {
	const paths = fixture();
	const registry = readScopedMcpRegistry(paths.registryPath);
	registry[PROFILES_KEY] = {
		reusable: {
			mcpServers: { profiled: { command: "profile-command" } },
		},
	};
	(registry.project as { profiles?: string[] }).profiles = ["reusable"];
	writeScopedMcpRegistry(paths.registryPath, registry);

	const status = formatScopedMcpStatus(paths.project, {
		PI_SCOPED_MCP_CONFIG: paths.registryPath,
	});

	assert.match(status, /Profiles: reusable/);
	assert.match(
		status,
		/profiled: enabled, proxy, prefix: server, scope: profile reusable/,
	);
});

test("global target rejects servers that exist only in a project", () => {
	const paths = fixture();

	assert.throws(
		() =>
			setServerDisabled({
				cwd: paths.project,
				disabled: true,
				registryPath: paths.registryPath,
				serverName: "project",
				target: "global",
			}),
		/not defined in "\$global"/,
	);
});
