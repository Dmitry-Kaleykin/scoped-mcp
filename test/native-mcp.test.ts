import assert from "node:assert/strict";
import test from "node:test";
import {
	droppedAdapterKeys,
	translateSelection,
	translateServerEntry,
} from "../src/native-mcp.ts";

test("translates adapter-era filters and timeouts to native MCP settings", () => {
	assert.deepEqual(
		translateServerEntry("legacy", {
			command: "legacy-mcp",
			args: ["--stdio"],
			directTools: true,
			includeTools: ["search*"],
			excludeTools: ["search_secret"],
			requestTimeoutMs: 30_000,
			disabled: true,
		}),
		{
			type: "stdio",
			command: "legacy-mcp",
			args: ["--stdio"],
			exposure: "hidden",
			toolExposure: {
				"search*": "direct",
				search_secret: "hidden",
			},
			timeout: 30,
			enabled: false,
		},
	);
});

test("native MCP settings take precedence over translated legacy defaults", () => {
	assert.deepEqual(
		translateServerEntry("native", {
			url: "https://example.invalid/mcp",
			exposure: "deferred",
			toolExposure: { lookup: "direct" },
			timeout: 45,
			requestTimeoutMs: 1_000,
		}),
		{
			type: "http",
			url: "https://example.invalid/mcp",
			exposure: "deferred",
			toolExposure: { lookup: "direct" },
			timeout: 45,
		},
	);
});

test("translates a scoped selection to Pi's native loaded config", () => {
	const loaded = translateSelection({
		config: {
			mcpServers: {
				global: { command: "global-mcp" },
				project: { command: "project-mcp", exposure: "direct" },
			},
			settings: { autoEnableCodemode: false },
		},
		profileNames: ["project-tools"],
		registryPath: "/tmp/scoped-mcp.json",
		serverOrigins: {
			global: "$global",
			project: "profile project-tools",
		},
		serverScopes: { global: "global", project: "project" },
	});

	assert.equal(loaded.autoEnableCodemode, false);
	assert.deepEqual(
		loaded.servers.map(({ name, scope, config }) => ({ name, scope, config })),
		[
			{
				name: "global",
				scope: "global",
				config: { type: "stdio", command: "global-mcp" },
			},
			{
				name: "project",
				scope: "project",
				config: {
					type: "stdio",
					command: "project-mcp",
					exposure: "direct",
				},
			},
		],
	);
});

test("custom prefixes and other unsupported adapter options are dropped", () => {
	assert.deepEqual(
		droppedAdapterKeys({
			command: "server",
			toolPrefix: "none",
			samplingAutoApprove: true,
		}),
		["toolPrefix", "samplingAutoApprove"],
	);
	assert.deepEqual(
		translateServerEntry("server", {
			command: "server",
			toolPrefix: "none",
		}),
		{ type: "stdio", command: "server" },
	);
});

test("invalid native settings are returned as startup errors", () => {
	const loaded = translateSelection({
		config: {
			mcpServers: {
				"invalid.name": { command: "server" },
				badUrl: { url: "file:///tmp/server" },
			},
			settings: { autoEnableCodemode: "yes" as unknown as boolean },
		},
		profileNames: [],
		registryPath: "/tmp/scoped-mcp.json",
		serverOrigins: { "invalid.name": "$global", badUrl: "$global" },
		serverScopes: { "invalid.name": "global", badUrl: "global" },
	});

	assert.deepEqual(loaded.servers, []);
	assert.equal(loaded.errors.length, 3);
	assert.match(loaded.errors.join("\n"), /invalid server name/);
	assert.match(loaded.errors.join("\n"), /url must be an http or https URL/);
	assert.match(loaded.errors.join("\n"), /autoEnableCodemode/);
});
