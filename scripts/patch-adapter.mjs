import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const supportedVersion = "2.15.0";
const packagePath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/package.json", import.meta.url),
);
const typesPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/types.ts", import.meta.url),
);
const initPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/init.ts", import.meta.url),
);
const samplingHandlerPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/sampling-handler.ts", import.meta.url),
);
const serverManagerPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/server-manager.ts", import.meta.url),
);
const adapterPackage = JSON.parse(readFileSync(packagePath, "utf8"));

if (adapterPackage.version !== supportedVersion) {
	throw new Error(
		`scoped-mcp's per-server tool-prefix patch supports pi-mcp-adapter ${supportedVersion}, but ${adapterPackage.version} is installed. Review and update scripts/patch-adapter.mjs before upgrading the adapter.`,
	);
}

let changed = false;

function patchFile(path, edits) {
	let source = readFileSync(path, "utf8");
	let fileChanged = false;
	for (const { original, replacement, label } of edits) {
		if (source.includes(replacement)) continue;
		if (!source.includes(original)) {
			throw new Error(
				`Could not apply scoped-mcp's ${label} patch to pi-mcp-adapter ${supportedVersion}`,
			);
		}
		source = source.replace(original, replacement);
		fileChanged = true;
	}
	if (fileChanged) writeFileSync(path, source, "utf8");
	changed ||= fileChanged;
}

patchFile(typesPath, [
	{
		original: 'export type ToolPrefix = "server" | "none" | "short" | "mcp";',
		replacement: [
			'export type ToolPrefixMode = "server" | "none" | "short" | "mcp";',
			"export type ToolPrefix = ToolPrefixMode | Readonly<Record<string, ToolPrefixMode>>;",
		].join("\n"),
		label: "prefix-map type",
	},
	{
		original: [
			"export function getServerPrefix(",
			"  serverName: string,",
			"  mode: ToolPrefix",
			"): string {",
		].join("\n"),
		replacement: [
			"export function getServerPrefix(",
			"  serverName: string,",
			"  mode: ToolPrefix",
			"): string {",
			'  if (typeof mode !== "string") mode = mode[serverName] ?? "server";',
		].join("\n"),
		label: "per-server prefix lookup",
	},
	{
		original: "  requestTimeoutMs?: number; // milliseconds, overrides global request timeout when > 0",
		replacement: [
			"  requestTimeoutMs?: number; // milliseconds, overrides global request timeout when > 0",
			"  /** Trust this server's sampling requests without interactive confirmations. */",
			"  samplingAutoApprove?: boolean;",
		].join("\n"),
		label: "per-server sampling type",
	},
]);

patchFile(initPath, [
	{
		original: [
			"  const samplingAutoApprove = config.settings?.samplingAutoApprove === true;",
			"  if (config.settings?.sampling !== false && (hasUI || samplingAutoApprove)) {",
		].join("\n"),
		replacement: [
			"  const samplingAutoApprove = config.settings?.samplingAutoApprove === true;",
			"  const hasServerSamplingAutoApprove = Object.values(config.mcpServers)",
			"    .some(server => server.samplingAutoApprove === true);",
			"  if (config.settings?.sampling !== false && (hasUI || samplingAutoApprove || hasServerSamplingAutoApprove)) {",
		].join("\n"),
		label: "per-server sampling enablement",
	},
]);

patchFile(serverManagerPath, [
	{
		original: "    const client = this.createClient(name);",
		replacement: "    const client = this.createClient(name, definition);",
		label: "sampling server definition routing",
	},
	{
		original: "  private createClient(serverName: string): Client {",
		replacement: "  private createClient(serverName: string, definition: ServerDefinition): Client {",
		label: "sampling client definition",
	},
	{
		original: "      registerSamplingHandler(client, { ...this.samplingConfig, serverName });",
		replacement: [
			"      registerSamplingHandler(client, {",
			"        ...this.samplingConfig,",
			"        serverName,",
			"        autoApprove: definition.samplingAutoApprove ?? this.samplingConfig.autoApprove,",
			"      });",
		].join("\n"),
		label: "per-server sampling approval",
	},
]);

patchFile(samplingHandlerPath, [
	{
		original: 'import { throwIfAborted } from "./abort.ts";',
		replacement: [
			'import { throwIfAborted } from "./abort.ts";',
			'import { combineAbortSignals } from "./runtime-owner.ts";',
		].join("\n"),
		label: "sampling cancellation import",
	},
	{
		original: [
			'  client.setRequestHandler("sampling/createMessage", (request) => {',
			"    return handleSamplingRequest(options, request as CreateMessageRequest);",
			"  });",
		].join("\n"),
		replacement: [
			'  client.setRequestHandler("sampling/createMessage", (request, context) => {',
			"    return handleSamplingRequest(options, request as CreateMessageRequest, context.signal);",
			"  });",
		].join("\n"),
		label: "sampling request cancellation routing",
	},
	{
		original: [
			"  request: CreateMessageRequest,",
			"): Promise<CreateMessageResult> {",
			"  const params = request.params;",
			"  const signal = options.getSignal();",
		].join("\n"),
		replacement: [
			"  request: CreateMessageRequest,",
			"  requestSignal?: AbortSignal,",
			"): Promise<CreateMessageResult> {",
			"  const params = request.params;",
			"  const signal = combineAbortSignals(options.getSignal(), requestSignal);",
		].join("\n"),
		label: "sampling request signal",
	},
	{
		original: "  const { model, apiKey, headers } = await resolveSamplingModel(options, params.modelPreferences);",
		replacement: "  const { model, apiKey, headers } = await resolveSamplingModel(options, params.modelPreferences, signal);",
		label: "sampling model resolution cancellation",
	},
	{
		original: [
			"  options: SamplingHandlerOptions,",
			"  modelPreferences: ModelPreferences | undefined,",
			"): Promise<{",
		].join("\n"),
		replacement: [
			"  options: SamplingHandlerOptions,",
			"  modelPreferences: ModelPreferences | undefined,",
			"  signal?: AbortSignal,",
			"): Promise<{",
		].join("\n"),
		label: "sampling model resolver signal",
	},
	{
		original: [
			"  const errors: string[] = [];",
			"  const signal = options.getSignal();",
			"  for (const model of candidates) {",
		].join("\n"),
		replacement: [
			"  const errors: string[] = [];",
			"  for (const model of candidates) {",
		].join("\n"),
		label: "sampling resolver request signal use",
	},
]);

if (changed) {
	console.info(
		`scoped-mcp: patched pi-mcp-adapter ${supportedVersion} for per-server prefixes and sampling trust`,
	);
}
