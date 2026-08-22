# scoped-mcp

A small Pi package that supplies `pi-mcp-adapter` with:

- MCP servers that work globally.
- Additional MCP servers selected by the directory where Pi starts.
- No `.pi` or MCP configuration files inside your projects.
- A direct dependency on upstream `pi-mcp-adapter`, without maintaining a fork.

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
        "lifecycle": "lazy",
        "toolPrefix": "short"
      }
    }
  },
  "my-php-project": {
    "path": "/Users/me/Projects/my-php-project",
    "mcpServers": {
      "phpstorm": {
        "command": "/command/copied/from/phpstorm",
        "args": ["arguments", "copied", "from", "phpstorm"],
        "lifecycle": "lazy",
        "toolPrefix": "none"
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
The one exception is a project entry containing only `disabled`, `toolPrefix`,
`samplingAutoApprove`, or a combination of them; it acts as a safe override for
an inherited global server.
`settings` are shallow-merged, with project values taking precedence.

Tool prefixes are configured per MCP server with `toolPrefix`. The supported
values are the same as upstream: `"server"` (the default), `"short"`, `"none"`,
and `"mcp"`. Root-level `settings.toolPrefix` is intentionally rejected by this
wrapper; move it onto each server that needs non-default behavior. A project
can override an inherited global server's prefix without copying its connection
details. A complete project server definition replaces the prefix together with
the rest of the definition.

Sampling approval can be trusted per MCP server with
`"samplingAutoApprove": true`. This suppresses both sampling confirmation
dialogs only for that server; other servers retain interactive approval. Use it
only for servers whose prompts and returned model output you trust. Canceled
MCP requests also cancel their in-flight sampling model call, so an expired tool
call cannot continue into a late response-approval dialog.

Paste the server object supplied by PhpStorm under the project's `mcpServers`.
Current PhpStorm versions provide this through **Settings → Tools → MCP Server →
Manual Client Configuration**.

Because the adapter receives a programmatic configuration snapshot, its normal
file discovery and `imports` are intentionally not used. `/mcp setup`,
`/mcp enable`, and `/mcp disable` cannot edit this registry. Status, reconnect,
authentication, proxy calls, and direct tools continue to work.

The following original adapter subcommands are redundant when using
`scoped-mcp`:

```text
/mcp setup
/mcp enable
/mcp disable
```

Use `/scoped-mcp edit`, `/scoped-mcp enable`, and `/scoped-mcp disable`
instead. Keep the original `/mcp` command available: its runtime operations such
as `/mcp tools`, `/mcp prompts`, `/mcp reconnect`, `/mcp logout`, and
`/mcp-auth` remain useful.

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

This project imports the supported `createMcpAdapter()` factory. Upstream 2.15.0
accepts only one prefix mode and only a global sampling trust setting.
[`scripts/patch-adapter.mjs`](./scripts/patch-adapter.mjs) applies a
version-pinned compatibility patch during `npm install`: the naming helper
accepts the per-server mode map, sampling trust can be selected per server, and
the adapter forwards each MCP sampling request's cancellation signal. The patch
fails loudly against an unreviewed adapter version.

To download the newest upstream release without running the version-pinned
postinstall patch:

```sh
cd /Users/donais/Documents/Projects/scoped-mcp
npm run update:adapter
```

Review upstream's prefix implementation. If the patch is still needed, update
`supportedVersion` and any changed source anchors in `scripts/patch-adapter.mjs`.
Then apply it, run the checks, and restart Pi:

```sh
npm install
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
