import { createMcpAdapter } from "pi-mcp-adapter";
import { loadScopedMcpConfig } from "./src/registry.ts";

const selection = loadScopedMcpConfig();

if (selection.projectName) {
  console.info(
    `[scoped-mcp] Loaded global MCPs plus project "${selection.projectName}" from ${selection.registryPath}`,
  );
} else {
  console.info(`[scoped-mcp] Loaded global MCPs from ${selection.registryPath}`);
}

export default createMcpAdapter({ config: selection.config });
