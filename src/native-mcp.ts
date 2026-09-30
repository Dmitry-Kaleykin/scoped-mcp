import type {
	LoadedMcpConfig,
	McpExposure,
	McpServerConfig,
} from "@earendil-works/pi-coding-agent";
import type {
	RegistryServerEntry,
	ScopedMcpSelection,
} from "./registry.ts";
import { getRegistryExposure, isServerDisabled } from "./registry.ts";

const MCP_EXPOSURES = new Set<McpExposure>([
	"codemode",
	"codemode-deferred",
	"deferred",
	"direct",
	"hidden",
]);
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

const NATIVE_KEYS = new Set([
	"args",
	"command",
	"cwd",
	"enabled",
	"env",
	"exposure",
	"headers",
	"oauth",
	"timeout",
	"toolExposure",
	"type",
	"url",
]);

const TRANSLATED_LEGACY_KEYS = new Set([
	"directTools",
	"disabled",
	"excludeTools",
	"includeTools",
	"requestTimeoutMs",
]);

function stringArray(value: unknown, label: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`${label} must be an array of strings`);
	}
	return value;
}

function stringRecord(
	value: unknown,
	label: string,
): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.values(value).some((item) => typeof item !== "string")
	) {
		throw new Error(`${label} must be an object whose values are strings`);
	}
	return value as Record<string, string>;
}

function requireExposure(value: unknown, label: string): McpExposure {
	if (!MCP_EXPOSURES.has(value as McpExposure)) {
		throw new Error(
			`${label} must be codemode, codemode-deferred, deferred, direct, or hidden`,
		);
	}
	return value as McpExposure;
}

function validateEntry(name: string, entry: RegistryServerEntry): void {
	if (!SERVER_NAME.test(name)) {
		throw new Error(
			`invalid server name "${name}" (use letters, digits, "_" and "-")`,
		);
	}
	if (entry.exposure !== undefined) requireExposure(entry.exposure, "exposure");
	if (
		entry.type !== undefined &&
		entry.type !== "stdio" &&
		entry.type !== "http"
	) {
		throw new Error(`server "${name}": type must be stdio or http`);
	}
	if (entry.toolExposure !== undefined) {
		if (
			!entry.toolExposure ||
			typeof entry.toolExposure !== "object" ||
			Array.isArray(entry.toolExposure)
		) {
			throw new Error("toolExposure must be an object");
		}
		for (const [tool, exposure] of Object.entries(entry.toolExposure)) {
			requireExposure(exposure, `toolExposure.${tool}`);
		}
	}
	if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") {
		throw new Error("enabled must be true or false");
	}
	if (entry.disabled !== undefined && typeof entry.disabled !== "boolean") {
		throw new Error("disabled must be true or false");
	}
	if (entry.timeout !== undefined && !(typeof entry.timeout === "number" && entry.timeout > 0)) {
		throw new Error("timeout must be a positive number of seconds");
	}
	if (
		entry.requestTimeoutMs !== undefined &&
		!(typeof entry.requestTimeoutMs === "number" && entry.requestTimeoutMs > 0)
	) {
		throw new Error("requestTimeoutMs must be a positive number");
	}
	if (
		entry.directTools !== undefined &&
		typeof entry.directTools !== "boolean" &&
		!Array.isArray(entry.directTools)
	) {
		throw new Error("directTools must be true, false, or an array of strings");
	}
}

function legacyToolExposure(
	entry: RegistryServerEntry,
): Record<string, McpExposure> | undefined {
	const explicit = entry.toolExposure ?? {};
	const generated: Record<string, McpExposure> = {};
	const directTools = Array.isArray(entry.directTools)
		? stringArray(entry.directTools, "directTools")
		: undefined;
	const includeTools = stringArray(entry.includeTools, "includeTools");
	const excludeTools = stringArray(entry.excludeTools, "excludeTools");
	const includedExposure = getRegistryExposure(entry);

	for (const pattern of includeTools ?? []) generated[pattern] = includedExposure;
	for (const name of directTools ?? []) generated[name] = "direct";
	for (const pattern of excludeTools ?? []) generated[pattern] = "hidden";

	const merged = { ...generated, ...explicit };
	return Object.keys(merged).length > 0 ? merged : undefined;
}

export function translateServerEntry(
	name: string,
	entry: RegistryServerEntry,
): McpServerConfig {
	validateEntry(name, entry);
	const toolExposure = legacyToolExposure(entry);
	const common = {
		...(entry.exposure !== undefined || entry.directTools === true
			? { exposure: getRegistryExposure(entry) }
			: {}),
		...(entry.includeTools?.length ? { exposure: "hidden" as const } : {}),
		...(toolExposure ? { toolExposure } : {}),
		...(entry.disabled !== undefined
			? { enabled: !entry.disabled }
			: entry.enabled !== undefined
				? { enabled: entry.enabled }
				: {}),
		...(entry.timeout !== undefined
			? { timeout: entry.timeout }
			: typeof entry.requestTimeoutMs === "number" && entry.requestTimeoutMs > 0
				? { timeout: entry.requestTimeoutMs / 1000 }
				: {}),
	};

	if (typeof entry.url === "string") {
		if (entry.command !== undefined) {
			throw new Error(`server "${name}" must define either url or command, not both`);
		}
		if (entry.type === "stdio") {
			throw new Error(`server "${name}": stdio type requires command`);
		}
		if (!URL.canParse(entry.url) || !/^https?:$/.test(new URL(entry.url).protocol)) {
			throw new Error(`server "${name}": url must be an http or https URL`);
		}
		if (
			entry.oauth !== undefined &&
			(!entry.oauth || typeof entry.oauth !== "object" || Array.isArray(entry.oauth))
		) {
			throw new Error(`server "${name}": oauth must be an object`);
		}
		return {
			...common,
			type: "http",
			url: entry.url,
			...(stringRecord(entry.headers, "headers")
				? { headers: stringRecord(entry.headers, "headers") }
				: {}),
			...(entry.oauth !== undefined ? { oauth: entry.oauth } : {}),
		} as McpServerConfig;
	}

	if (typeof entry.command !== "string" || entry.command.length === 0) {
		throw new Error(`server "${name}" must define a non-empty command or url`);
	}
	if (entry.type === "http") {
		throw new Error(`server "${name}": http type requires url`);
	}
	if (entry.cwd !== undefined && typeof entry.cwd !== "string") {
		throw new Error(`server "${name}": cwd must be a string`);
	}
	return {
		...common,
		type: "stdio",
		command: entry.command,
		...(stringArray(entry.args, "args") ? { args: entry.args } : {}),
		...(stringRecord(entry.env, "env") ? { env: entry.env } : {}),
		...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
	};
}

export function droppedAdapterKeys(entry: RegistryServerEntry): string[] {
	return Object.keys(entry).filter(
		(key) => !NATIVE_KEYS.has(key) && !TRANSLATED_LEGACY_KEYS.has(key),
	);
}

export function translateSelection(
	selection: ScopedMcpSelection,
): LoadedMcpConfig {
	const servers: LoadedMcpConfig["servers"] = [];
	const errors: string[] = [];
	const autoEnableCodemode = selection.config.settings?.autoEnableCodemode;
	if (
		autoEnableCodemode !== undefined &&
		typeof autoEnableCodemode !== "boolean"
	) {
		errors.push("settings.autoEnableCodemode must be true or false");
	}

	for (const [name, entry] of Object.entries(selection.config.mcpServers)) {
		try {
			servers.push({
				name,
				config: translateServerEntry(name, entry),
				source: `${selection.registryPath} (${selection.serverOrigins[name]})`,
				scope: selection.serverScopes[name] ?? "global",
			});
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	return {
		servers,
		errors,
		...(typeof autoEnableCodemode === "boolean"
			? { autoEnableCodemode }
			: {}),
	};
}

export function describeExposure(entry: RegistryServerEntry): string {
	const translated = translateServerEntry("status", entry);
	const exposure = translated.exposure ?? "codemode";
	const overrides = Object.keys(translated.toolExposure ?? {}).length;
	return overrides > 0
		? `${exposure} (${overrides} tool override${overrides === 1 ? "" : "s"})`
		: exposure;
}

export function describeEnabled(entry: RegistryServerEntry): string {
	return isServerDisabled(entry) ? "disabled" : "enabled";
}
