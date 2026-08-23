export type ToolPrefix = "server" | "none" | "short" | "mcp";

export interface ServerEntry {
	command?: string;
	args?: string[];
	socket?: string;
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
	auth?: "oauth" | "bearer" | false;
	bearerToken?: string;
	bearerTokenEnv?: string;
	oauth?: Record<string, unknown> | false;
	lifecycle?: "keep-alive" | "lazy" | "lazy-keep-alive" | "eager";
	idleTimeout?: number;
	requestTimeoutMs?: number;
	samplingAutoApprove?: boolean;
	exposeResources?: boolean;
	directTools?: boolean | string[];
	includeTools?: string[];
	excludeTools?: string[];
	debug?: boolean;
	trace?: boolean;
	disabled?: boolean;
	toolPrefix?: ToolPrefix;
}

export interface McpSettings {
	toolPrefix?: ToolPrefix;
	showStatusIcon?: boolean;
	mcpFooterStatus?: "full" | "compact" | "off";
	notifyOnStartupConnect?: boolean;
	idleTimeout?: number;
	requestTimeoutMs?: number;
	directTools?: boolean;
	warnOnLargeDirectTools?: boolean;
	scriptMode?: boolean;
	toolResultRendering?: "compact" | "boxed";
	collapsedResultLines?: 1 | 2 | 3;
	disableProxyTool?: boolean;
	freezeDirectTools?: boolean;
	autoAuth?: boolean;
	sampling?: boolean;
	samplingAutoApprove?: boolean;
	elicitation?: boolean;
	outputGuard?: boolean | Record<string, number>;
	trace?: Record<string, unknown>;
	authRequiredMessage?: string;
	oauthDir?: string;
}

export interface McpConfig {
	mcpServers: Record<string, ServerEntry>;
	settings?: McpSettings;
}
