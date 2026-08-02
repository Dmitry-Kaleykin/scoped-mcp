import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildTerminalAppleScript,
	selectTerminalEditor,
} from "../src/editor.ts";

test("prefers micro and falls back to nano", () => {
	const root = mkdtempSync(join(tmpdir(), "scoped-mcp-editor-"));
	const nano = join(root, "nano");
	writeFileSync(nano, "");
	chmodSync(nano, 0o700);
	assert.equal(selectTerminalEditor(root), nano);

	const micro = join(root, "micro");
	writeFileSync(micro, "");
	chmodSync(micro, 0o700);
	assert.equal(selectTerminalEditor(root), micro);
});

test("builds a new Terminal window command with shell-safe paths", () => {
	const script = buildTerminalAppleScript(
		"/opt/homebrew/bin/micro",
		"/Users/me/configs/it's scoped.json",
	);

	assert.match(script, /tell application "Terminal"/);
	assert.match(script, /do script/);
	assert.match(script, /micro/);
	assert.match(script, /it'\\?"'\\?"'s scoped\.json/);
	assert.match(script, /activate/);
});
