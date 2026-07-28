import { createMcpAdapter } from "pi-mcp-adapter";
import { registerScopedMcpCommand } from "./src/commands.ts";
import type { ScopedPiApi } from "./src/pi-api.ts";
import { loadScopedMcpConfig } from "./src/registry.ts";

const selection = loadScopedMcpConfig();

if (selection.projectName) {
  console.info(
    `[scoped-mcp] Loaded global MCPs plus project "${selection.projectName}" from ${selection.registryPath}`,
  );
} else {
  console.info(`[scoped-mcp] Loaded global MCPs from ${selection.registryPath}`);
}

const mcpAdapter = createMcpAdapter({ config: selection.config });

export default function scopedMcp(pi: ScopedPiApi): void {
  registerScopedMcpCommand(pi);
  mcpAdapter(pi);
}
