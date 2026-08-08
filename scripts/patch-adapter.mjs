import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const supportedVersion = "2.15.0";
const packagePath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/package.json", import.meta.url),
);
const typesPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/types.ts", import.meta.url),
);
const adapterPackage = JSON.parse(readFileSync(packagePath, "utf8"));

if (adapterPackage.version !== supportedVersion) {
	throw new Error(
		`scoped-mcp's per-server tool-prefix patch supports pi-mcp-adapter ${supportedVersion}, but ${adapterPackage.version} is installed. Review and update scripts/patch-adapter.mjs before upgrading the adapter.`,
	);
}

let source = readFileSync(typesPath, "utf8");
let changed = false;

function replaceOnce(original, replacement, label) {
	if (source.includes(replacement)) return;
	if (!source.includes(original)) {
		throw new Error(
			`Could not apply scoped-mcp's ${label} patch to pi-mcp-adapter ${supportedVersion}`,
		);
	}
	source = source.replace(original, replacement);
	changed = true;
}

replaceOnce(
	'export type ToolPrefix = "server" | "none" | "short" | "mcp";',
	[
		'export type ToolPrefixMode = "server" | "none" | "short" | "mcp";',
		"export type ToolPrefix = ToolPrefixMode | Readonly<Record<string, ToolPrefixMode>>;",
	].join("\n"),
	"prefix-map type",
);

replaceOnce(
	[
		"export function getServerPrefix(",
		"  serverName: string,",
		"  mode: ToolPrefix",
		"): string {",
	].join("\n"),
	[
		"export function getServerPrefix(",
		"  serverName: string,",
		"  mode: ToolPrefix",
		"): string {",
		'  if (typeof mode !== "string") mode = mode[serverName] ?? "server";',
	].join("\n"),
	"per-server prefix lookup",
);

if (changed) {
	writeFileSync(typesPath, source, "utf8");
	console.info(
		`scoped-mcp: patched pi-mcp-adapter ${supportedVersion} for per-server tool prefixes`,
	);
}
