import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { McpExposure } from "@earendil-works/pi-coding-agent";

export const GLOBAL_SCOPE_KEY = "$global";
export const PROFILES_KEY = "$profiles";
export const SCOPE_PATH_PLACEHOLDER = "${scope.path}";
export const REGISTRY_PATH_ENV = "PI_SCOPED_MCP_CONFIG";

export interface RegistryServerEntry {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
	oauth?: Record<string, unknown>;
	type?: "stdio" | "http";
	exposure?: McpExposure;
	toolExposure?: Record<string, McpExposure>;
	enabled?: boolean;
	disabled?: boolean;
	timeout?: number;
	requestTimeoutMs?: number;
	directTools?: boolean | string[];
	includeTools?: string[];
	excludeTools?: string[];
	[key: string]: unknown;
}

export interface RegistrySettings {
	autoEnableCodemode?: boolean;
	[key: string]: unknown;
}

export interface ScopedMcpConfig {
	mcpServers: Record<string, RegistryServerEntry>;
	settings?: RegistrySettings;
}

export interface RegistryProfile {
	mcpServers?: Record<string, RegistryServerEntry>;
	settings?: RegistrySettings;
}

export interface RegistryScope extends RegistryProfile {
	path?: string;
	profiles?: string[];
	[key: string]: unknown;
}

export type ScopedMcpRegistry = Record<string, RegistryScope>;

export interface ScopedMcpSelection {
	config: ScopedMcpConfig;
	projectName?: string;
	projectPath?: string;
	profileNames: string[];
	registryPath: string;
	serverOrigins: Record<string, string>;
	serverScopes: Record<string, "global" | "project">;
}

export type ScopeTarget = "effective" | "global" | "project";

export interface ServerToggleResult {
	changed: boolean;
	disabled: boolean;
	scopeName: string;
	serverName: string;
	registryPath: string;
}

export interface ServerExposureResult {
	changed: boolean;
	exposure: McpExposure;
	scopeName: string;
	serverName: string;
	registryPath: string;
}

function defaultAgentDir(env: NodeJS.ProcessEnv): string {
	return env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function getRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env[REGISTRY_PATH_ENV];
	return resolve(
		configured ||
			join(
				defaultAgentDir(env),
				"extensions",
				"scoped-mcp",
				"scoped-mcp.json",
			),
	);
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function canonicalExistingPath(
	path: string,
	label: string,
	requireAbsolute = false,
): string {
	const expanded = expandHome(path);
	if (requireAbsolute && !isAbsolute(expanded)) {
		throw new Error(`[scoped-mcp] ${label} must be absolute: ${path}`);
	}
	const absolute = resolve(expanded);
	if (!existsSync(absolute)) {
		throw new Error(`[scoped-mcp] ${label} does not exist: ${absolute}`);
	}
	return realpathSync.native(absolute);
}

function containsPath(root: string, child: string): boolean {
	const fromRoot = relative(root, child);
	return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`[scoped-mcp] ${label} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function parseConfigLayer(
	object: Record<string, unknown>,
	label: string,
): RegistryProfile {
	const mcpServers = object.mcpServers;
	const settings = object.settings;

	if (mcpServers !== undefined) {
		const servers = requireObject(mcpServers, `${label}.mcpServers`);
		for (const [serverName, entry] of Object.entries(servers)) {
			requireObject(entry, `${label}.mcpServers["${serverName}"]`);
		}
	}
	if (settings !== undefined) {
		requireObject(settings, `${label}.settings`);
	}

	return {
		...(mcpServers
			? { mcpServers: mcpServers as Record<string, RegistryServerEntry> }
			: {}),
		...(settings ? { settings: settings as RegistrySettings } : {}),
	};
}

function parseScope(name: string, value: unknown): RegistryScope {
	const label = `scope "${name}"`;
	const object = requireObject(value, label);
	const path = object.path;
	const profiles = object.profiles;

	if (name === GLOBAL_SCOPE_KEY && path !== undefined) {
		throw new Error(`[scoped-mcp] "${GLOBAL_SCOPE_KEY}" must not define "path"`);
	}
	if (name !== GLOBAL_SCOPE_KEY && typeof path !== "string") {
		throw new Error(`[scoped-mcp] project "${name}" must define an absolute "path"`);
	}
	if (
		profiles !== undefined &&
		(!Array.isArray(profiles) ||
			profiles.some((profile) => typeof profile !== "string" || profile.length === 0))
	) {
		throw new Error(`[scoped-mcp] ${label}.profiles must be an array of profile names`);
	}
	if (Array.isArray(profiles) && new Set(profiles).size !== profiles.length) {
		throw new Error(`[scoped-mcp] ${label}.profiles must not contain duplicates`);
	}

	return {
		...parseConfigLayer(object, label),
		...(typeof path === "string" ? { path } : {}),
		...(Array.isArray(profiles) ? { profiles: profiles as string[] } : {}),
	};
}

function parseProfiles(value: unknown): Record<string, RegistryProfile> {
	const profiles = requireObject(value, `"${PROFILES_KEY}"`);
	return Object.fromEntries(
		Object.entries(profiles).map(([name, profile]) => {
			if (!name || name.startsWith("$")) {
				throw new Error(`[scoped-mcp] Invalid profile name: "${name}"`);
			}
			const label = `profile "${name}"`;
			const object = requireObject(profile, label);
			if (object.path !== undefined || object.profiles !== undefined) {
				throw new Error(
					`[scoped-mcp] ${label} must not define "path" or "profiles"`,
				);
			}
			return [name, parseConfigLayer(object, label)];
		}),
	);
}

export function parseRegistry(raw: unknown): ScopedMcpRegistry {
	const object = requireObject(raw, "registry");
	const profiles = parseProfiles(object[PROFILES_KEY] ?? {});
	const registry: ScopedMcpRegistry = {};

	for (const [name, value] of Object.entries(object)) {
		if (name === PROFILES_KEY) {
			registry[name] = profiles as unknown as RegistryScope;
			continue;
		}
		if (name.startsWith("$") && name !== GLOBAL_SCOPE_KEY) {
			throw new Error(`[scoped-mcp] Unknown reserved registry key: "${name}"`);
		}
		const scope = parseScope(name, value);
		for (const profileName of scope.profiles ?? []) {
			if (!profiles[profileName]) {
				throw new Error(
					`[scoped-mcp] scope "${name}" references unknown profile "${profileName}"`,
				);
			}
		}
		registry[name] = scope;
	}
	for (const profileName of registry[GLOBAL_SCOPE_KEY]?.profiles ?? []) {
		if (containsScopePathPlaceholder(profiles[profileName]?.mcpServers)) {
			throw new Error(
				`[scoped-mcp] profile "${profileName}" is activated by "${GLOBAL_SCOPE_KEY}" and must not use ${SCOPE_PATH_PLACEHOLDER}`,
			);
		}
	}

	return registry;
}

export function getRegistryProfiles(
	registry: ScopedMcpRegistry,
): Record<string, RegistryProfile> {
	return (registry[PROFILES_KEY] as unknown as Record<string, RegistryProfile>) ?? {};
}

export function isInheritedServerOverride(entry: RegistryServerEntry): boolean {
	const keys = Object.keys(entry);
	return (
		keys.length > 0 &&
		keys.every(
			(key) =>
				key === "disabled" ||
				key === "enabled" ||
				key === "exposure" ||
				key === "toolExposure" ||
				key === "toolPrefix" ||
				key === "samplingAutoApprove",
		)
	);
}

interface NamedLayer {
	label: string;
	scope: RegistryProfile;
}

interface ActiveLayer extends NamedLayer {
	kind: "global-profile" | "global" | "project-profile" | "project";
	source: RegistryProfile;
}

function containsScopePathPlaceholder(value: unknown): boolean {
	if (typeof value === "string") return value.includes(SCOPE_PATH_PLACEHOLDER);
	if (Array.isArray(value)) return value.some(containsScopePathPlaceholder);
	if (value && typeof value === "object") {
		return Object.values(value).some(containsScopePathPlaceholder);
	}
	return false;
}

function interpolateScopePath(value: unknown, projectPath: string): unknown {
	if (typeof value === "string") {
		return value.replaceAll(SCOPE_PATH_PLACEHOLDER, projectPath);
	}
	if (Array.isArray(value)) {
		return value.map((item) => interpolateScopePath(item, projectPath));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				interpolateScopePath(item, projectPath),
			]),
		);
	}
	return value;
}

function resolveProfileScopePath(
	profile: RegistryProfile,
	projectPath: string,
): RegistryProfile {
	if (!profile.mcpServers) return profile;
	return {
		...profile,
		mcpServers: Object.fromEntries(
			Object.entries(profile.mcpServers).map(([name, entry]) => [
				name,
				interpolateScopePath(entry, projectPath) as RegistryServerEntry,
			]),
		),
	};
}

function activeLayers(
	registry: ScopedMcpRegistry,
	projectName?: string,
	projectPath?: string,
): ActiveLayer[] {
	const globalScope = registry[GLOBAL_SCOPE_KEY] ?? {};
	const projectScope = projectName ? registry[projectName] : undefined;
	const profiles = getRegistryProfiles(registry);
	return [
		...(globalScope.profiles ?? []).map((name) => {
			const source = profiles[name] as RegistryProfile;
			return {
				kind: "global-profile" as const,
				label: `profile ${name} (global)`,
				scope: source,
				source,
			};
		}),
		{
			kind: "global",
			label: GLOBAL_SCOPE_KEY,
			scope: globalScope,
			source: globalScope,
		},
		...(projectScope?.profiles ?? []).map((name) => {
			const source = profiles[name] as RegistryProfile;
			return {
				kind: "project-profile" as const,
				label: `profile ${name}`,
				scope: projectPath ? resolveProfileScopePath(source, projectPath) : source,
				source,
			};
		}),
		...(projectScope
			? [
					{
						kind: "project" as const,
						label: projectName as string,
						scope: projectScope,
						source: projectScope,
					},
				]
			: []),
	];
}

function mergeLayers(layers: NamedLayer[]): {
	config: ScopedMcpConfig;
	serverOrigins: Record<string, string>;
	serverScopes: Record<string, "global" | "project">;
} {
	const mcpServers: Record<string, RegistryServerEntry> = {};
	const serverOrigins: Record<string, string> = {};
	const serverScopes: Record<string, "global" | "project"> = {};
	let settings: RegistrySettings | undefined;

	for (const layer of layers) {
		for (const [name, entry] of Object.entries(layer.scope.mcpServers ?? {})) {
			const inherited = mcpServers[name];
			if (inherited && isInheritedServerOverride(entry)) {
				const merged = { ...inherited, ...entry };
				if (entry.enabled !== undefined && entry.disabled === undefined) {
					delete merged.disabled;
				}
				if (entry.disabled !== undefined && entry.enabled === undefined) {
					delete merged.enabled;
				}
				mcpServers[name] = merged;
				serverOrigins[name] = `${layer.label} override`;
			} else {
				mcpServers[name] = entry;
				serverOrigins[name] = layer.label;
			}
			if ("kind" in layer) {
				const kind = (layer as ActiveLayer).kind;
				serverScopes[name] = kind.startsWith("global") ? "global" : "project";
			}
		}
		if (layer.scope.settings) {
			settings = { ...(settings ?? {}), ...layer.scope.settings };
		}
	}

	return { config: { mcpServers, settings }, serverOrigins, serverScopes };
}

export function readScopedMcpRegistry(registryPath: string): ScopedMcpRegistry {
	if (!existsSync(registryPath)) return {};

	try {
		return parseRegistry(JSON.parse(readFileSync(registryPath, "utf8")));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`[scoped-mcp] Failed to read ${registryPath}: ${message}`);
	}
}

export function ensureScopedMcpRegistry(registryPath: string): boolean {
	if (existsSync(registryPath)) return false;
	writeScopedMcpRegistry(registryPath, {
		[GLOBAL_SCOPE_KEY]: { mcpServers: {} },
	});
	return true;
}

export function writeScopedMcpRegistry(
	registryPath: string,
	registry: ScopedMcpRegistry,
): void {
	const parent = dirname(registryPath);
	mkdirSync(parent, { recursive: true, mode: 0o700 });
	const temporaryPath = join(
		parent,
		`.${Date.now()}-${process.pid}-scoped-mcp.json.tmp`,
	);

	try {
		writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporaryPath, registryPath);
	} catch (error) {
		if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
		throw error;
	}
}

export function selectScopedMcpConfig(
	registry: ScopedMcpRegistry,
	cwd: string,
	registryPath = "<memory>",
): ScopedMcpSelection {
	const canonicalCwd = canonicalExistingPath(cwd, "working directory");

	const match = Object.entries(registry)
		.filter(([name]) => name !== GLOBAL_SCOPE_KEY && name !== PROFILES_KEY)
		.map(([name, scope]) => {
			const projectPath = canonicalExistingPath(
				scope.path as string,
				`project "${name}" path`,
				true,
			);
			return { name, scope, projectPath };
		})
		.filter(({ projectPath }) => containsPath(projectPath, canonicalCwd))
		.sort((left, right) => right.projectPath.length - left.projectPath.length)[0];
	const profileNames = [
		...(registry[GLOBAL_SCOPE_KEY]?.profiles ?? []),
		...(match?.scope.profiles ?? []),
	];
	const merged = mergeLayers(activeLayers(registry, match?.name, match?.projectPath));

	return {
		config: merged.config,
		...(match
			? { projectName: match.name, projectPath: match.projectPath }
			: {}),
		profileNames,
		registryPath,
		serverOrigins: merged.serverOrigins,
		serverScopes: merged.serverScopes,
	};
}

function deleteDisabled(entry: RegistryServerEntry): RegistryServerEntry {
	const next = { ...entry };
	delete next.disabled;
	delete next.enabled;
	return next;
}

function toggledEntry(
	entry: RegistryServerEntry | undefined,
	inherited: RegistryServerEntry | undefined,
	disabled: boolean,
): RegistryServerEntry | undefined {
	if (entry && !isInheritedServerOverride(entry)) {
		return disabled
			? { ...deleteDisabled(entry), disabled: true }
			: deleteDisabled(entry);
	}

	const next = { ...(entry ?? {}) };
	delete next.enabled;
	if (isServerDisabled(inherited) === disabled) {
		delete next.disabled;
	} else {
		next.disabled = disabled;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function isServerDisabled(
	entry: RegistryServerEntry | undefined,
): boolean {
	if (entry?.disabled !== undefined) return entry.disabled;
	return entry?.enabled === false;
}

export function getRegistryExposure(
	entry: RegistryServerEntry | undefined,
): McpExposure {
	if (entry?.exposure) return entry.exposure;
	return entry?.directTools === true ? "direct" : "codemode";
}

export function setServerDisabled(options: {
	cwd: string;
	disabled: boolean;
	registryPath: string;
	serverName: string;
	target?: ScopeTarget;
}): ServerToggleResult {
	const registry = readScopedMcpRegistry(options.registryPath);
	const selection = selectScopedMcpConfig(
		registry,
		options.cwd,
		options.registryPath,
	);
	const projectName = selection.projectName;
	const projectScope = projectName ? registry[projectName] : undefined;
	const layers = activeLayers(registry, projectName, selection.projectPath);
	let targetLayer: ActiveLayer | undefined;
	const target = options.target ?? "effective";
	if (target === "global") {
		targetLayer = layers.find((layer) => layer.kind === "global");
	} else if (target === "project") {
		if (!projectName || !projectScope) {
			throw new Error(
				`[scoped-mcp] No project scope matches ${canonicalExistingPath(options.cwd, "working directory")}`,
			);
		}
		targetLayer = layers.find((layer) => layer.kind === "project");
	} else {
		targetLayer = [...layers]
			.reverse()
			.find((layer) => layer.scope.mcpServers?.[options.serverName]);
		if (!targetLayer) {
			throw new Error(
				`[scoped-mcp] Server "${options.serverName}" is not defined in the active scope`,
			);
		}
	}
	if (!targetLayer) {
		throw new Error("[scoped-mcp] Could not resolve the target configuration layer");
	}

	const targetIndex = layers.indexOf(targetLayer);
	const inherited = mergeLayers(layers.slice(0, targetIndex)).config.mcpServers[
		options.serverName
	];
	const currentEntry = targetLayer.source.mcpServers?.[options.serverName];
	if (!currentEntry && !inherited) {
		if (target === "global") {
			throw new Error(
				`[scoped-mcp] Server "${options.serverName}" is not defined in "${GLOBAL_SCOPE_KEY}" or its profiles`,
			);
		}
		throw new Error(
			`[scoped-mcp] Server "${options.serverName}" is not defined in project "${projectName}" or its inherited scopes`,
		);
	}

	const nextEntry = toggledEntry(currentEntry, inherited, options.disabled);
	const changed = JSON.stringify(nextEntry) !== JSON.stringify(currentEntry);
	const targetScope = targetLayer.source;
	targetScope.mcpServers ??= {};
	if (nextEntry) {
		targetScope.mcpServers[options.serverName] = nextEntry;
	} else {
		delete targetScope.mcpServers[options.serverName];
	}
	if (changed) writeScopedMcpRegistry(options.registryPath, registry);

	return {
		changed,
		disabled: options.disabled,
		scopeName: targetLayer.label,
		serverName: options.serverName,
		registryPath: options.registryPath,
	};
}

export function setServerExposure(options: {
	cwd: string;
	exposure: McpExposure;
	registryPath: string;
	serverName: string;
}): ServerExposureResult {
	const registry = readScopedMcpRegistry(options.registryPath);
	const selection = selectScopedMcpConfig(
		registry,
		options.cwd,
		options.registryPath,
	);
	const layers = activeLayers(
		registry,
		selection.projectName,
		selection.projectPath,
	);
	const targetLayer = [...layers]
		.reverse()
		.find((layer) => layer.scope.mcpServers?.[options.serverName]);
	if (!targetLayer) {
		throw new Error(
			`[scoped-mcp] Server "${options.serverName}" is not defined in the active scope`,
		);
	}

	const targetIndex = layers.indexOf(targetLayer);
	const inherited = mergeLayers(layers.slice(0, targetIndex)).config.mcpServers[
		options.serverName
	];
	const currentEntry = targetLayer.source.mcpServers?.[options.serverName];
	if (!currentEntry) {
		throw new Error(
			`[scoped-mcp] Could not resolve the definition of server "${options.serverName}"`,
		);
	}

	const nextEntry = { ...currentEntry };
	const defaultExposure = isInheritedServerOverride(currentEntry)
		? getRegistryExposure(inherited)
		: getRegistryExposure({ ...currentEntry, exposure: undefined });
	if (options.exposure === defaultExposure) {
		delete nextEntry.exposure;
	} else {
		nextEntry.exposure = options.exposure;
	}

	const shouldDelete = Object.keys(nextEntry).length === 0;
	const changed = JSON.stringify(nextEntry) !== JSON.stringify(currentEntry);
	if (shouldDelete) {
		delete targetLayer.source.mcpServers?.[options.serverName];
	} else {
		targetLayer.source.mcpServers ??= {};
		targetLayer.source.mcpServers[options.serverName] = nextEntry;
	}
	if (changed) writeScopedMcpRegistry(options.registryPath, registry);

	return {
		changed,
		exposure: options.exposure,
		scopeName: targetLayer.label,
		serverName: options.serverName,
		registryPath: options.registryPath,
	};
}

export function loadScopedMcpConfig(options?: {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}): ScopedMcpSelection {
	const env = options?.env ?? process.env;
	const registryPath = getRegistryPath(env);

	return selectScopedMcpConfig(
		readScopedMcpRegistry(registryPath),
		options?.cwd ?? process.cwd(),
		registryPath,
	);
}
