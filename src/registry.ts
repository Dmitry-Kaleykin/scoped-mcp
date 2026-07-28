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
import type { McpConfig, McpSettings, ServerEntry } from "pi-mcp-adapter/types";

export const GLOBAL_SCOPE_KEY = "$global";
export const REGISTRY_PATH_ENV = "PI_MCP_PROJECTS_CONFIG";

export interface RegistryScope {
  path?: string;
  mcpServers?: Record<string, ServerEntry>;
  settings?: McpSettings;
}

export type ScopedMcpRegistry = Record<string, RegistryScope>;

export interface ScopedMcpSelection {
  config: McpConfig;
  projectName?: string;
  projectPath?: string;
  registryPath: string;
}

export type ScopeTarget = "effective" | "global" | "project";

export interface ServerToggleResult {
  changed: boolean;
  disabled: boolean;
  scopeName: string;
  serverName: string;
  registryPath: string;
}

function defaultAgentDir(env: NodeJS.ProcessEnv): string {
  return env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function getRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[REGISTRY_PATH_ENV];
  return resolve(configured || join(defaultAgentDir(env), "mcp-projects.json"));
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

function parseScope(name: string, value: unknown): RegistryScope {
  const object = requireObject(value, `scope "${name}"`);
  const path = object.path;
  const mcpServers = object.mcpServers;
  const settings = object.settings;

  if (name === GLOBAL_SCOPE_KEY && path !== undefined) {
    throw new Error(`[scoped-mcp] "${GLOBAL_SCOPE_KEY}" must not define "path"`);
  }
  if (name !== GLOBAL_SCOPE_KEY && typeof path !== "string") {
    throw new Error(`[scoped-mcp] project "${name}" must define an absolute "path"`);
  }
  if (mcpServers !== undefined) {
    requireObject(mcpServers, `scope "${name}".mcpServers`);
  }
  if (settings !== undefined) {
    requireObject(settings, `scope "${name}".settings`);
  }

  return {
    ...(typeof path === "string" ? { path } : {}),
    ...(mcpServers ? { mcpServers: mcpServers as Record<string, ServerEntry> } : {}),
    ...(settings ? { settings: settings as McpSettings } : {}),
  };
}

export function parseRegistry(raw: unknown): ScopedMcpRegistry {
  const object = requireObject(raw, "registry");
  return Object.fromEntries(
    Object.entries(object).map(([name, value]) => [name, parseScope(name, value)]),
  );
}

function isDisabledOnlyOverride(entry: ServerEntry): boolean {
  const keys = Object.keys(entry);
  return keys.length === 1 && keys[0] === "disabled";
}

function mergeScopes(globalScope: RegistryScope, projectScope?: RegistryScope): McpConfig {
  const mcpServers = { ...(globalScope.mcpServers ?? {}) };
  for (const [name, projectEntry] of Object.entries(projectScope?.mcpServers ?? {})) {
    const globalEntry = mcpServers[name];
    mcpServers[name] =
      globalEntry && isDisabledOnlyOverride(projectEntry)
        ? { ...globalEntry, ...projectEntry }
        : projectEntry;
  }

  return {
    mcpServers,
    settings:
      globalScope.settings || projectScope?.settings
        ? {
            ...(globalScope.settings ?? {}),
            ...(projectScope?.settings ?? {}),
          }
        : undefined,
  };
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
    `.${Date.now()}-${process.pid}-mcp-projects.json.tmp`,
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
  const globalScope = registry[GLOBAL_SCOPE_KEY] ?? {};

  const match = Object.entries(registry)
    .filter(([name]) => name !== GLOBAL_SCOPE_KEY)
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

  return {
    config: mergeScopes(globalScope, match?.scope),
    ...(match
      ? { projectName: match.name, projectPath: match.projectPath }
      : {}),
    registryPath,
  };
}

function deleteDisabled(entry: ServerEntry): ServerEntry {
  const next = { ...entry };
  delete next.disabled;
  return next;
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
  const globalScope = registry[GLOBAL_SCOPE_KEY] ?? { mcpServers: {} };
  const projectName = selection.projectName;
  const projectScope = projectName ? registry[projectName] : undefined;
  const globalEntry = globalScope.mcpServers?.[options.serverName];
  const projectEntry = projectScope?.mcpServers?.[options.serverName];

  let scopeName: string;
  const target = options.target ?? "effective";
  if (target === "global") {
    scopeName = GLOBAL_SCOPE_KEY;
  } else if (target === "project") {
    if (!projectName || !projectScope) {
      throw new Error(
        `[scoped-mcp] No project scope matches ${canonicalExistingPath(options.cwd, "working directory")}`,
      );
    }
    scopeName = projectName;
  } else {
    scopeName = projectEntry ? (projectName as string) : GLOBAL_SCOPE_KEY;
  }

  if (scopeName === GLOBAL_SCOPE_KEY) {
    if (!globalEntry) {
      throw new Error(
        `[scoped-mcp] Server "${options.serverName}" is not defined in "${GLOBAL_SCOPE_KEY}"`,
      );
    }
    globalScope.mcpServers ??= {};
    const nextEntry = options.disabled
      ? { ...globalEntry, disabled: true }
      : deleteDisabled(globalEntry);
    const changed = JSON.stringify(nextEntry) !== JSON.stringify(globalEntry);
    globalScope.mcpServers[options.serverName] = nextEntry;
    registry[GLOBAL_SCOPE_KEY] = globalScope;
    if (changed) writeScopedMcpRegistry(options.registryPath, registry);
    return {
      changed,
      disabled: options.disabled,
      scopeName,
      serverName: options.serverName,
      registryPath: options.registryPath,
    };
  }

  const targetScope = registry[scopeName] as RegistryScope;
  targetScope.mcpServers ??= {};
  if (!projectEntry && !globalEntry) {
    throw new Error(
      `[scoped-mcp] Server "${options.serverName}" is not defined in project "${scopeName}" or "${GLOBAL_SCOPE_KEY}"`,
    );
  }

  let nextEntry: ServerEntry | undefined;
  if (projectEntry && !isDisabledOnlyOverride(projectEntry)) {
    nextEntry = options.disabled
      ? { ...projectEntry, disabled: true }
      : deleteDisabled(projectEntry);
  } else if (options.disabled) {
    nextEntry = { disabled: true };
  } else if (globalEntry?.disabled === true) {
    nextEntry = { disabled: false };
  }

  const changed = JSON.stringify(nextEntry) !== JSON.stringify(projectEntry);
  if (nextEntry) {
    targetScope.mcpServers[options.serverName] = nextEntry;
  } else {
    delete targetScope.mcpServers[options.serverName];
  }
  if (changed) writeScopedMcpRegistry(options.registryPath, registry);

  return {
    changed,
    disabled: options.disabled,
    scopeName,
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
