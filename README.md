# scoped-mcp

A Pi extension that adds scopes, reusable profiles, path interpolation, and
persistent configuration on top of Pi's built-in MCP implementation.

It keeps MCP configuration outside project directories while using Pi's native
MCP transports, OAuth, resources, progress, cancellation, codemode,
`tool_search`, and `/mcp` manager.

## Configuration

The default registry is:

```text
~/.pi/agent/extensions/scoped-mcp/scoped-mcp.json
```

If `PI_CODING_AGENT_DIR` is set, the registry lives in that agent directory.
Set `PI_SCOPED_MCP_CONFIG` to use another file.

Start with [`scoped-mcp.example.json`](./scoped-mcp.example.json):

```json
{
  "$global": {
    "profiles": ["common"]
  },
  "$profiles": {
    "common": {
      "mcpServers": {
        "global-server": {
          "command": "npx",
          "args": ["-y", "some-mcp-server"],
          "exposure": "codemode"
        }
      }
    },
    "project-tools": {
      "mcpServers": {
        "project-server": {
          "command": "/absolute/path/to/project-mcp",
          "args": ["--project", "${scope.path}"],
          "exposure": "direct"
        }
      }
    }
  },
  "my-project": {
    "path": "/Users/me/Projects/my-project",
    "profiles": ["project-tools"]
  }
}
```

`$global` applies in every directory. `$profiles` contains reusable named
layers. Every other top-level key is a project scope whose absolute `path` must
exist. A project matches its root and descendants; for nested scopes, the
deepest matching path wins.

Precedence, from lowest to highest, is:

1. profiles listed by `$global`
2. `$global`
3. profiles listed by the selected project
4. the selected project

A complete same-named server definition replaces the inherited definition.
An entry containing only `disabled`, `enabled`, `exposure`, or `toolExposure`
acts as an override without copying connection details. `settings` are
shallow-merged in the same order.

`${scope.path}` inside a project profile is replaced recursively with the
canonical selected project path. It works in strings nested under `args`,
`env`, headers, and similar fields. Globally activated profiles cannot use the
placeholder because no project path is guaranteed.

### Native MCP settings

Server definitions accept Pi's native MCP fields:

- stdio: `command`, `args`, `env`, and `cwd`
- HTTP: `url`, `headers`, and `oauth`
- behavior: `enabled`, `timeout`, `exposure`, and `toolExposure`

Exposure can be `codemode`, `codemode-deferred`, `deferred`, `direct`, or
`hidden`. `toolExposure` can override individual tool names or wildcard
patterns. At the layer level, `settings.autoEnableCodemode` is supported.

Pi's native tool names are always `mcp__<server>__<tool>`. Custom MCP name
prefixes are intentionally not reimplemented.

For migration, these adapter-era fields are translated when present:

- `disabled` → `enabled: false`
- `requestTimeoutMs` → native `timeout` seconds
- `directTools`, `includeTools`, and `excludeTools` → native exposure settings

Other adapter-only options, including `toolPrefix`, are ignored and reported
once in the Pi log. Remove them after upgrading the registry.

## Commands

Show the active scope, profiles, effective servers, exposure, and origins:

```text
/scoped-mcp status
```

Enable or disable the effective definition:

```text
/scoped-mcp disable phpstorm
/scoped-mcp enable phpstorm
```

Target `$global` or the selected project explicitly:

```text
/scoped-mcp disable phpstorm --global
/scoped-mcp enable phpstorm --project
```

Changes are written atomically with owner-only permissions, then Pi reloads.

Open the registry in a new macOS Terminal window:

```text
/scoped-mcp edit
```

It uses `micro` when available and falls back to `nano`. Run `/reload` after
saving.

Pi's built-in `/mcp` command remains available. Enable/disable and exposure
changes made there are persisted into the effective scoped registry layer.

## Install

```sh
cd /Users/donais/Documents/Projects/scoped-mcp
npm install
pi remove npm:pi-mcp-adapter
pi install /Users/donais/Documents/Projects/scoped-mcp
```

The package requires Pi 0.99.1 and Node.js 22.19 or newer. Restart or reload Pi
after installation.

## Development

```sh
npm test
npm run check
git status
```
