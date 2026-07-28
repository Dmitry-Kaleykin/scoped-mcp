import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
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

function mergeScopes(globalScope: RegistryScope, projectScope?: RegistryScope): McpConfig {
  return {
    mcpServers: {
      ...(globalScope.mcpServers ?? {}),
      ...(projectScope?.mcpServers ?? {}),
    },
    settings:
      globalScope.settings || projectScope?.settings
        ? {
            ...(globalScope.settings ?? {}),
            ...(projectScope?.settings ?? {}),
          }
        : undefined,
  };
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

export function loadScopedMcpConfig(options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): ScopedMcpSelection {
  const env = options?.env ?? process.env;
  const registryPath = getRegistryPath(env);

  if (!existsSync(registryPath)) {
    return {
      config: { mcpServers: {} },
      registryPath,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[scoped-mcp] Failed to read ${registryPath}: ${message}`);
  }

  return selectScopedMcpConfig(
    parseRegistry(raw),
    options?.cwd ?? process.cwd(),
    registryPath,
  );
}
