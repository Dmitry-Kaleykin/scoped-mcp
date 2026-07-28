# scoped-mcp

A small Pi package that supplies `pi-mcp-adapter` with:

- MCP servers that work globally.
- Additional MCP servers selected by the directory where Pi starts.
- No `.pi` or MCP configuration files inside your projects.
- A direct dependency on upstream `pi-mcp-adapter`, without a fork.

## Configuration

The default registry is:

```text
~/.pi/agent/mcp-projects.json
```

If `PI_CODING_AGENT_DIR` is set, the registry lives in that directory instead.
Set `PI_MCP_PROJECTS_CONFIG` to use an entirely different file.

Start with [`mcp-projects.example.json`](./mcp-projects.example.json):

```json
{
  "$global": {
    "mcpServers": {
      "global-server": {
        "command": "npx",
        "args": ["-y", "some-mcp-server"],
        "lifecycle": "lazy"
      }
    }
  },
  "my-php-project": {
    "path": "/Users/me/Projects/my-php-project",
    "mcpServers": {
      "phpstorm": {
        "command": "/command/copied/from/phpstorm",
        "args": ["arguments", "copied", "from", "phpstorm"],
        "lifecycle": "lazy"
      }
    }
  }
}
```

`$global` is optional and works in every directory. Each other top-level key is
a project name. Its `path` must exist. A project matches both its root and every
directory below it, so starting Pi in a project subdirectory still works.
Nested project entries are supported; the deepest matching path wins.

Project MCP servers are merged over the global set. When both scopes define the
same server name, the complete project definition replaces the global one. This
avoids carrying credentials from a global URL into a project-specific URL.
The one exception is a project entry containing only `disabled`; it acts as a
safe enable/disable override for an inherited global server.
`settings` are shallow-merged, with project values taking precedence.

Paste the server object supplied by PhpStorm under the project's `mcpServers`.
Current PhpStorm versions provide this through **Settings → Tools → MCP Server →
Manual Client Configuration**.

Because the adapter receives a programmatic configuration snapshot, its normal
file discovery and `imports` are intentionally not used. `/mcp setup`,
`/mcp enable`, and `/mcp disable` cannot edit this registry. Status, reconnect,
authentication, proxy calls, and direct tools continue to work.

## Commands

Show the selected registry, active project scope, effective servers, their
enabled state, proxy/direct mode, and configuration origin:

```text
/scoped-mcp status
```

With no subcommand, `/scoped-mcp` also shows status.

Enable or disable the scope that currently owns a server. A project definition
wins; otherwise the command updates `$global`:

```text
/scoped-mcp disable phpstorm
/scoped-mcp enable phpstorm
```

Target `$global` explicitly:

```text
/scoped-mcp disable phpstorm --global
/scoped-mcp enable phpstorm --global
```

Target the current project explicitly:

```text
/scoped-mcp disable phpstorm --project
/scoped-mcp enable phpstorm --project
```

`--project` can disable a server inherited from `$global` only for the current
project. It can also enable a globally disabled server only for the current
project. Changes are saved atomically with owner-only file permissions, and Pi
reloads automatically when a value changes.

Open the registry in a new macOS Terminal window:

```text
/scoped-mcp edit
```

The command uses `micro` when available and falls back to `nano`. If the
registry does not exist, it creates a minimal one first. Run `/reload` after
saving and closing the editor.

## Install

Install dependencies:

```sh
cd /Users/donais/Documents/Projects/scoped-mcp
npm install
```

Remove the standalone adapter package if it is currently enabled. Loading both
would register the same Pi tool and commands twice:

```sh
pi remove npm:pi-mcp-adapter
```

Install this package globally:

```sh
pi install /Users/donais/Documents/Projects/scoped-mcp
```

Restart Pi after installation or configuration changes.

## Update pi-mcp-adapter

This project imports the supported `createMcpAdapter()` factory and contains no
forked adapter code. To upgrade to the newest upstream release and update both
`package.json` and `package-lock.json`:

```sh
cd /Users/donais/Documents/Projects/scoped-mcp
npm run update:adapter
```

Then run the checks and restart Pi:

```sh
npm test
npm run check
```

To check without changing anything:

```sh
npm run check:adapter
```

Review major adapter releases before updating because their public factory or
configuration types may contain breaking changes.

## Development

```sh
npm test
npm run check
git status
```
