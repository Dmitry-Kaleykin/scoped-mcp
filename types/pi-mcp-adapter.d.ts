import type { McpConfig } from "pi-mcp-adapter/types";

export interface McpAdapterOptions {
	config?: McpConfig;
	configPath?: string;
}

export function createMcpAdapter(
	options?: McpAdapterOptions,
): (pi: unknown) => void;
