import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const supportedVersion = "2.27.0";
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
const directToolsPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/direct-tools.ts", import.meta.url),
);
const proxyModesPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/proxy-modes.ts", import.meta.url),
);
const indexPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/index.ts", import.meta.url),
);
const toolResultRendererPath = fileURLToPath(
	new URL("../node_modules/pi-mcp-adapter/tool-result-renderer.ts", import.meta.url),
);
const adapterPackage = JSON.parse(readFileSync(packagePath, "utf8"));

if (adapterPackage.version !== supportedVersion) {
	throw new Error(
		`scoped-mcp's compatibility patch supports pi-mcp-adapter ${supportedVersion}, but ${adapterPackage.version} is installed. Review and update scripts/patch-adapter.mjs before upgrading the adapter.`,
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
			'  client.setRequestHandler("sampling/createMessage", request => {',
			"    return handleSamplingRequest(options, request);",
			"  });",
		].join("\n"),
		replacement: [
			'  client.setRequestHandler("sampling/createMessage", (request, context) => {',
			"    return handleSamplingRequest(options, request, context.signal);",
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

patchFile(directToolsPath, [
	{
		original: "  return async function execute(_toolCallId, params, signal) {",
		replacement: "  return async function execute(_toolCallId, params, signal, onUpdate) {",
		label: "direct-tool progress callback",
	},
	{
		original:
			"    const requestOptions = state.manager.getRequestOptions?.(spec.serverName, ownedSignal) ?? (ownedSignal ? { signal: ownedSignal } : undefined);",
		replacement: [
			"    const requestOptions = state.manager.getRequestOptions?.(spec.serverName, ownedSignal) ?? (ownedSignal ? { signal: ownedSignal } : undefined);",
			"    const progressOptions = {",
			"      ...(requestOptions ?? {}),",
			"      onprogress: (progress: { progress: number; total?: number; message?: string }) => {",
			"        const percent = typeof progress.total === \"number\" && progress.total > 0",
			"          ? Math.max(0, Math.min(100, Math.round((progress.progress / progress.total) * 100)))",
			"          : null;",
			"        const message = progress.message?.trim() || \"MCP tool is working\";",
			"        onUpdate?.({",
			"          content: [{ type: \"text\" as const, text: percent === null ? message : `${message} · ${percent}%` }],",
			"          details: { server: spec.serverName, tool: spec.originalName, progress: progress.progress, total: progress.total },",
			"        });",
			"      },",
			"    };",
		].join("\n"),
		label: "direct-tool MCP progress forwarding",
	},
	{
		original: "        }, requestOptions), ownedSignal),",
		replacement: "        }, progressOptions), ownedSignal),",
		label: "direct-tool progress request options",
	},
]);

patchFile(proxyModesPath, [
	{
		original:
			'import type { AgentToolResult, ToolInfo } from "@earendil-works/pi-coding-agent";',
		replacement:
			'import type { AgentToolResult, AgentToolUpdateCallback, ToolInfo } from "@earendil-works/pi-coding-agent";',
		label: "proxy progress callback type",
	},
	{
		original: [
			"  signal?: AbortSignal,",
			'  origin?: "proxy" | "script",',
			"): Promise<ProxyToolResult> {",
		].join("\n"),
		replacement: [
			"  signal?: AbortSignal,",
			'  origin?: "proxy" | "script",',
			"  onUpdate?: AgentToolUpdateCallback<Record<string, unknown>>,",
			"): Promise<ProxyToolResult> {",
		].join("\n"),
		label: "proxy progress callback parameter",
	},
	{
		original:
			"  const requestOptions = state.manager.getRequestOptions?.(serverName, ownedSignal) ?? (ownedSignal ? { signal: ownedSignal } : undefined);",
		replacement: [
			"  const requestOptions = state.manager.getRequestOptions?.(serverName, ownedSignal) ?? (ownedSignal ? { signal: ownedSignal } : undefined);",
			"  const progressOptions = {",
			"    ...(requestOptions ?? {}),",
			"    onprogress: (progress: { progress: number; total?: number; message?: string }) => {",
			"      const percent = typeof progress.total === \"number\" && progress.total > 0",
			"        ? Math.max(0, Math.min(100, Math.round((progress.progress / progress.total) * 100)))",
			"        : null;",
			"      const message = progress.message?.trim() || \"MCP tool is working\";",
			"      onUpdate?.({",
			"        content: [{ type: \"text\" as const, text: percent === null ? message : `${message} · ${percent}%` }],",
			"        details: { mode: \"call\", ...callIdentity, progress: progress.progress, total: progress.total },",
			"      });",
			"    },",
			"  };",
		].join("\n"),
		label: "proxy MCP progress forwarding",
	},
	{
		original: "      }, requestOptions), ownedSignal),",
		replacement: "      }, progressOptions), ownedSignal),",
		label: "proxy progress request options",
	},
]);

patchFile(indexPath, [
	{
		original:
			"      }, signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined, _ctx: ExtensionContext) {",
		replacement:
			"      }, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined, _ctx: ExtensionContext) {",
		label: "proxy Pi update callback",
	},
	{
		original:
			"          return executeCall(state, dispatchParams.tool, parsedArgs, dispatchParams.server, getPiTools, signal);",
		replacement:
			'          return executeCall(state, dispatchParams.tool, parsedArgs, dispatchParams.server, getPiTools, signal, "proxy", onUpdate);',
		label: "proxy Pi progress routing",
	},
]);

patchFile(toolResultRendererPath, [
	{
		original: [
			"  if (options.isPartial) {",
			'    return new Text(activeTheme.fg("warning", "Running MCP tool..."), 0, 0);',
			"  }",
		].join("\n"),
		replacement: [
			"  if (options.isPartial) {",
			"    const progress = formatMcpToolResultLines(result, true).lines.join(\"\\n\");",
			'    return new Text(activeTheme.fg("warning", progress || "Running MCP tool..."), 0, 0);',
			"  }",
		].join("\n"),
		label: "partial MCP progress rendering",
	},
]);

if (changed) {
	console.info(
		`scoped-mcp: patched pi-mcp-adapter ${supportedVersion} for per-server sampling trust and progress updates`,
	);
}
