import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	formatToolName,
	resolveToolPrefix,
} from "../node_modules/pi-mcp-adapter/types.ts";

test("upstream adapter resolves prefix modes per server", () => {
	assert.equal(
		formatToolName(
			"open.page",
			"browser-mcp",
			resolveToolPrefix({ toolPrefix: "short" }, "server"),
		),
		"browser_open_page",
	);
	assert.equal(
		formatToolName(
			"search",
			"docs",
			resolveToolPrefix({ toolPrefix: "none" }, "server"),
		),
		"search",
	);
	assert.equal(
		formatToolName(
			"issue",
			"github",
			resolveToolPrefix({ toolPrefix: "mcp" }, "server"),
		),
		"mcp__github_issue",
	);
	assert.equal(resolveToolPrefix({}, "short"), "short");
});

test("patched adapter scopes sampling trust and forwards request cancellation", () => {
	const manager = readFileSync(
		fileURLToPath(
			new URL(
				"../node_modules/pi-mcp-adapter/server-manager.ts",
				import.meta.url,
			),
		),
		"utf8",
	);
	const handler = readFileSync(
		fileURLToPath(
			new URL(
				"../node_modules/pi-mcp-adapter/sampling-handler.ts",
				import.meta.url,
			),
		),
		"utf8",
	);

	assert.match(
		manager,
		/autoApprove: definition\.samplingAutoApprove \?\? this\.samplingConfig\.autoApprove/,
	);
	assert.match(
		handler,
		/handleSamplingRequest\(options, request, context\.signal\)/,
	);
});

test("patched adapter forwards MCP progress to Pi tool updates", () => {
	const adapterRoot = new URL("../node_modules/pi-mcp-adapter/", import.meta.url);
	const directTools = readFileSync(
		fileURLToPath(new URL("direct-tools.ts", adapterRoot)),
		"utf8",
	);
	const proxyModes = readFileSync(
		fileURLToPath(new URL("proxy-modes.ts", adapterRoot)),
		"utf8",
	);
	const index = readFileSync(
		fileURLToPath(new URL("index.ts", adapterRoot)),
		"utf8",
	);
	const renderer = readFileSync(
		fileURLToPath(new URL("tool-result-renderer.ts", adapterRoot)),
		"utf8",
	);

	assert.match(
		directTools,
		/execute\(_toolCallId, params, signal, onUpdate\)/,
	);
	assert.match(directTools, /onprogress: \(progress:/);
	assert.match(directTools, /onUpdate\?\.\(\{/);
	assert.match(directTools, /}, progressOptions\), ownedSignal\)/);

	assert.match(proxyModes, /onUpdate\?: AgentToolUpdateCallback/);
	assert.match(proxyModes, /onprogress: \(progress:/);
	assert.match(proxyModes, /if \(onUpdate\) \{/);
	assert.match(proxyModes, /toolMeta\.originalName,\s*onUpdate,/);
	assert.match(
		index,
		/executeCall\(state, params\.tool, parsedArgs, params\.server, getPiTools, signal, "proxy", onUpdate\)/,
	);

	assert.match(
		renderer,
		/formatMcpToolResultLines\(result, true\)\.lines\.join\("\\n"\)/,
	);
	assert.doesNotMatch(
		renderer,
		/if \(options\.isPartial\) \{\s*return new Text\(activeTheme\.fg\("warning", "Running MCP tool\.\.\."\)/,
	);
});
