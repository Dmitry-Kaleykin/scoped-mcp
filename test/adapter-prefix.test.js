import assert from "node:assert/strict";
import test from "node:test";
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
