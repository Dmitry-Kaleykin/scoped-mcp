import {
	createMcpExtension,
	type ExtensionAPI,
	type McpExtensionOptions,
} from "@earendil-works/pi-coding-agent";
import { registerScopedMcpCommand } from "./src/commands.ts";
import { droppedAdapterKeys, translateSelection } from "./src/native-mcp.ts";
import {
	getRegistryPath,
	loadScopedMcpConfig,
	setServerDisabled,
	setServerExposure,
} from "./src/registry.ts";

type NativeConfigPatch = Parameters<
	NonNullable<McpExtensionOptions["updateConfig"]>
>[1];

const warnedDroppedKeys = new Set<string>();

function reportSelection(cwd: string): ReturnType<typeof loadScopedMcpConfig> {
	const selection = loadScopedMcpConfig({ cwd });
	const profiles =
		selection.profileNames.length > 0
			? ` with profiles ${selection.profileNames.map((name) => `"${name}"`).join(", ")}`
			: "";
	console.info(
		selection.projectName
			? `[scoped-mcp] Loaded global MCPs${profiles} plus project "${selection.projectName}" from ${selection.registryPath}`
			: `[scoped-mcp] Loaded global MCPs${profiles} from ${selection.registryPath}`,
	);

	const dropped = new Set<string>();
	for (const entry of Object.values(selection.config.mcpServers)) {
		for (const key of droppedAdapterKeys(entry)) dropped.add(key);
	}
	for (const key of Object.keys(selection.config.settings ?? {})) {
		if (key !== "autoEnableCodemode") dropped.add(`settings.${key}`);
	}
	const newDropped = [...dropped].filter((key) => !warnedDroppedKeys.has(key));
	if (newDropped.length > 0) {
		for (const key of newDropped) warnedDroppedKeys.add(key);
		console.warn(
			`[scoped-mcp] Ignoring options that are not supported by Pi's built-in MCP: ${newDropped.join(", ")}`,
		);
	}

	return selection;
}

export default function scopedMcp(pi: ExtensionAPI): void | Promise<void> {
	let activeCwd = process.cwd();
	let activeRegistryPath = getRegistryPath();

	const nativeMcp = createMcpExtension({
		loadConfig(ctx) {
			activeCwd = ctx.cwd;
			const selection = reportSelection(ctx.cwd);
			activeRegistryPath = selection.registryPath;
			return translateSelection(selection);
		},
		updateConfig(entry, patch: NativeConfigPatch) {
			if (patch.enabled !== undefined) {
				setServerDisabled({
					cwd: activeCwd,
					disabled: !patch.enabled,
					registryPath: activeRegistryPath,
					serverName: entry.name,
				});
			}
			if (patch.exposure !== undefined) {
				setServerExposure({
					cwd: activeCwd,
					exposure: patch.exposure,
					registryPath: activeRegistryPath,
					serverName: entry.name,
				});
			}
		},
	});

	registerScopedMcpCommand(pi);
	return nativeMcp(pi);
}
