import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function executableFromPath(
  name: string,
  pathValue = process.env.PATH ?? "",
): string | undefined {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  return undefined;
}

export function selectTerminalEditor(
  pathValue = process.env.PATH ?? "",
): string | undefined {
  return (
    executableFromPath("micro", pathValue) ??
    executableFromPath("nano", pathValue) ??
    (existsSync("/usr/bin/nano") ? "/usr/bin/nano" : undefined)
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function appleScriptQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildTerminalAppleScript(
  editorPath: string,
  registryPath: string,
): string {
  const command = `clear; ${shellQuote(editorPath)} ${shellQuote(registryPath)}`;
  return [
    'tell application "Terminal"',
    `  do script ${appleScriptQuote(command)}`,
    "  activate",
    "end tell",
  ].join("\n");
}

export async function openRegistryInTerminal(
  registryPath: string,
  options?: {
    pathValue?: string;
    platform?: NodeJS.Platform;
  },
): Promise<string> {
  const platform = options?.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error(
      "[scoped-mcp] Opening a new terminal window is currently supported only on macOS",
    );
  }

  const editor = selectTerminalEditor(options?.pathValue);
  if (!editor) {
    throw new Error("[scoped-mcp] Neither micro nor nano is available");
  }

  await execFileAsync("/usr/bin/osascript", [
    "-e",
    buildTerminalAppleScript(editor, registryPath),
  ]);
  return editor;
}
