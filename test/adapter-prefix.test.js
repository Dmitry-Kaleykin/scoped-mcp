import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	formatToolName,
	getServerPrefix,
} from "../node_modules/pi-mcp-adapter/types.ts";

test("patched adapter resolves prefix modes per server", () => {
	const prefixes = {
		"browser-mcp": "short",
		docs: "none",
		github: "mcp",
	};

	assert.equal(
		formatToolName("open.page", "browser-mcp", prefixes),
		"browser_open_page",
	);
	assert.equal(formatToolName("search", "docs", prefixes), "search");
	assert.equal(formatToolName("issue", "github", prefixes), "mcp__github_issue");
	assert.equal(getServerPrefix("unconfigured", prefixes), "unconfigured");
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
		/handleSamplingRequest\(options, request as CreateMessageRequest, context\.signal\)/,
	);
});
