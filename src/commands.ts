import type { ServerEntry, ToolPrefix } from "pi-mcp-adapter/types";
import { openRegistryInTerminal } from "./editor.ts";
import type { ScopedCommandContext, ScopedPiApi } from "./pi-api.ts";
import {
	ensureScopedMcpRegistry,
	getRegistryPath,
	loadScopedMcpConfig,
	setServerDisabled,
	type ScopeTarget,
} from "./registry.ts";

const SUBCOMMANDS = ["status", "enable", "disable", "edit"] as const;

function usage(): string {
	return [
		"Usage:",
		"  /scoped-mcp status",
		"  /scoped-mcp enable <server> [--global|--project]",
		"  /scoped-mcp disable <server> [--global|--project]",
		"  /scoped-mcp edit",
	].join("\n");
}

function directToolsLabel(entry: ServerEntry): string {
	if (entry.directTools === true) return "direct: all";
	if (Array.isArray(entry.directTools)) {
		return `direct: ${entry.directTools.length} selected`;
	}
	return "proxy";
}

function toolPrefixLabel(entry: ServerEntry): ToolPrefix {
	return entry.toolPrefix ?? "server";
}

export function formatScopedMcpStatus(
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const selection = loadScopedMcpConfig({ cwd, env });
	const serverNames = Object.keys(selection.config.mcpServers).sort((left, right) =>
		left.localeCompare(right),
	);

	const lines = [
		`Registry: ${selection.registryPath}`,
		selection.projectName
			? `Scope: ${selection.projectName} (${selection.projectPath})`
			: "Scope: global only",
		`Profiles: ${selection.profileNames.length > 0 ? selection.profileNames.join(", ") : "(none)"}`,
		`Servers: ${serverNames.length}`,
	];

	if (serverNames.length === 0) {
		lines.push("  (none)");
	} else {
		for (const name of serverNames) {
			const effective = selection.config.mcpServers[name] as ServerEntry;
			const enabled = effective.disabled === true ? "disabled" : "enabled";
			const origin = selection.serverOrigins[name];
			lines.push(
				`  ${name}: ${enabled}, ${directToolsLabel(effective)}, prefix: ${toolPrefixLabel(effective)}, scope: ${origin}`,
			);
		}
	}

	return lines.join("\n");
}

function parseToggleArgs(
	args: string[],
): { serverName: string; target: ScopeTarget } {
	const flags = args.filter((value) => value.startsWith("--"));
	const names = args.filter((value) => !value.startsWith("--"));
	const unknownFlags = flags.filter(
		(value) => value !== "--global" && value !== "--project",
	);

	if (unknownFlags.length > 0) {
		throw new Error(`[scoped-mcp] Unknown option: ${unknownFlags.join(", ")}`);
	}
	if (flags.includes("--global") && flags.includes("--project")) {
		throw new Error("[scoped-mcp] Use either --global or --project, not both");
	}
	if (names.length !== 1) {
		throw new Error("[scoped-mcp] Exactly one server name is required");
	}

	return {
		serverName: names[0] as string,
		target: flags.includes("--global")
			? "global"
			: flags.includes("--project")
				? "project"
				: "effective",
	};
}

async function handleToggle(
	disabled: boolean,
	args: string[],
	ctx: ScopedCommandContext,
): Promise<void> {
	const parsed = parseToggleArgs(args);
	const result = setServerDisabled({
		cwd: ctx.cwd,
		disabled,
		registryPath: getRegistryPath(),
		serverName: parsed.serverName,
		target: parsed.target,
	});
	const state = disabled ? "disabled" : "enabled";

	if (!result.changed) {
		ctx.ui.notify(
			`${result.serverName} is already ${state} in ${result.scopeName}`,
			"info",
		);
		return;
	}

	ctx.ui.notify(
		`${result.serverName} ${state} in ${result.scopeName}; reloading`,
		"info",
	);
	await ctx.reload();
}

async function handleCommand(
	rawArgs: string,
	ctx: ScopedCommandContext,
): Promise<void> {
	const args = rawArgs.trim().split(/\s+/).filter(Boolean);
	const subcommand = args.shift() || "status";

	try {
		switch (subcommand) {
			case "status":
				if (args.length > 0) throw new Error(usage());
				ctx.ui.notify(formatScopedMcpStatus(ctx.cwd), "info");
				return;
			case "enable":
				await handleToggle(false, args, ctx);
				return;
			case "disable":
				await handleToggle(true, args, ctx);
				return;
			case "edit": {
				if (args.length > 0) throw new Error(usage());
				const registryPath = getRegistryPath();
				const created = ensureScopedMcpRegistry(registryPath);
				const editor = await openRegistryInTerminal(registryPath);
				ctx.ui.notify(
					`${created ? "Created and opened" : "Opened"} ${registryPath} in ${editor}. Run /reload after saving.`,
					"info",
				);
				return;
			}
			default:
				throw new Error(usage());
		}
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
	}
}

function argumentCompletions(prefix: string) {
	const trimmedStart = prefix.trimStart();
	const firstSpace = trimmedStart.indexOf(" ");
	if (firstSpace < 0) {
		const matches = SUBCOMMANDS.filter((value) => value.startsWith(trimmedStart));
		return matches.length
			? matches.map((value) => ({ value, label: value }))
			: null;
	}

	const subcommand = trimmedStart.slice(0, firstSpace);
	if (subcommand !== "enable" && subcommand !== "disable") return null;

	const remainder = trimmedStart.slice(firstSpace + 1);
	const currentToken = remainder.split(/\s+/).at(-1) ?? "";
	if (currentToken.startsWith("--")) {
		const flags = ["--global", "--project"].filter((value) =>
			value.startsWith(currentToken),
		);
		const preceding = remainder.slice(0, remainder.length - currentToken.length);
		return flags.length
			? flags.map((value) => ({
					value: `${subcommand} ${preceding}${value}`,
					label: value,
				}))
			: null;
	}

	try {
		const serverNames = Object.keys(loadScopedMcpConfig().config.mcpServers)
			.filter((value) => value.startsWith(currentToken))
			.sort((left, right) => left.localeCompare(right));
		return serverNames.length
			? serverNames.map((value) => ({
					value: `${subcommand} ${value}`,
					label: value,
				}))
			: null;
	} catch {
		return null;
	}
}

export function registerScopedMcpCommand(pi: ScopedPiApi): void {
	pi.registerCommand("scoped-mcp", {
		description: "Inspect and manage global and project-scoped MCP configuration",
		getArgumentCompletions: argumentCompletions,
		handler: handleCommand,
	});
}
