# OpenClaw MCP Tools

[中文文档](./README-zh.md)

[![npm version](https://img.shields.io/npm/v/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools) [![npm license](https://img.shields.io/npm/l/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools) [![npm downloads](https://img.shields.io/npm/dt/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools)

Bridge MCP server tools as native OpenClaw tools. AI agents can call them directly without CLI.

## Why not the official mcporter?

OpenClaw officially supports MCP through [mcporter](https://mcporter.dev) skill, but it has limitations:
1. Indirect invocation: `AI → read mcporter skill → shell command → mcporter CLI → MCP server`
2. MCP tools are invisible to the agent — you must manually list them in TOOLS.md

**Advantages of this plugin:**

| | mcporter (official) | OpenClaw MCP Tools (this plugin) |
|---|---|---|
| Invocation | AI runs shell commands | AI calls native tools directly |
| Latency | Spawns CLI process each time | Direct call, no overhead |
| Tool descriptions | AI must learn mcporter syntax | Tool schemas are directly visible |
| Dependency | Requires mcporter CLI | No extra dependencies |

In short: **mcporter teaches AI to use a hammer, this plugin puts the hammer directly in AI's hand**.

## Features

- Connect to multiple MCP servers simultaneously
- Auto-reconnect on disconnect
- Tool name prefix (avoid conflicts)
- Tool filtering
- Supports stdio / SSE / streamableHttp transports

## Installation

```bash
# Local link
openclaw plugins install -l ./openclaw-mcp-tools

# Or via npm
openclaw plugins install openclaw-mcp-tools
```

## Configuration

Add to your OpenClaw config file (`~/.openclaw/openclaw.json`):

### stdio transport (local process)

```json
{
  "plugins": {
    "entries": {
      "openclaw-mcp-tools": {
        "enabled": true,
        "config": {
          "servers": [
            {
              "name": "github",
              "type": "stdio",
              "command": "npx",
              "args": ["-y", "@modelcontextprotocol/server-github"],
              "env": { "GITHUB_TOKEN": "ghp_xxx" }
            }
          ]
        }
      }
    }
  }
}
```

### streamableHttp transport (remote server)

```json
{
  "plugins": {
    "entries": {
      "openclaw-mcp-tools": {
        "enabled": true,
        "config": {
          "servers": [
            {
              "name": "remote",
              "type": "streamableHttp",
              "url": "http://localhost:3000/mcp",
              "headers": { "Authorization": "Bearer xxx" }
            }
          ]
        }
      }
    }
  }
}
```

### Server configuration

Config path: `plugins.entries.openclaw-mcp-tools.config.servers[]`

| Field | Required | Transport | Description |
|-------|----------|-----------|-------------|
| `name` | Yes | All | Unique server identifier |
| `type` | Yes | All | `stdio` / `sse` / `streamableHttp` |
| `enabled` | No | All | Enable/disable, default `true` |
| `toolPrefix` | No | All | Tool name prefix, e.g. `web_` |
| `toolFilter` | No | All | Only load specified tools (array) |
| `command` | Yes* | `stdio` | Command to run, e.g. `npx` |
| `args` | No | `stdio` | Command arguments (array) |
| `env` | No | `stdio` | Environment variables, e.g. `{ "GITHUB_TOKEN": "ghp_xxx" }` |
| `url` | Yes* | `sse` / `streamableHttp` | Server URL |
| `headers` | No | `streamableHttp` | HTTP request headers, e.g. `{ "Authorization": "Bearer xxx" }` |

> *`command` is required for `stdio` transport; `url` is required for `sse` / `streamableHttp` transport.

### Global configuration

Config path: `plugins.entries.openclaw-mcp-tools.config`

| Field | Default | Description |
|-------|---------|-------------|
| `autoReconnect` | `true` | Auto-reconnect on disconnect |
| `reconnectDelayMs` | `5000` | Reconnect delay (ms) |
| `toolCallTimeoutMs` | `60000` | Tool call timeout (ms) |

## Troubleshooting

### Tool call timeout

When an MCP tool takes a long time to respond (e.g., image recognition), it may exceed the default 60s timeout. Increase it in the global config:

```json
"plugins": {
  "entries": {
    "openclaw-mcp-tools": {
      "config": {
        "toolCallTimeoutMs": 120000
      }
    }
  }
}
```

Note: OpenClaw itself may also have a tool call timeout. If so, you need to increase both.

### Tool name conflicts

When multiple MCP servers expose tools with the same name, the plugin automatically renames the later one to `serverName.toolName` (e.g., `github.web-search`) to avoid conflicts. You can also use `toolPrefix` to manually prevent conflicts:

```json
{
  "servers": [
    { "name": "server-a", "toolPrefix": "a_", ... },
    { "name": "server-b", "toolPrefix": "b_", ... }
  ]
}
```

### Other issues

| Issue | Solution |
|-------|----------|
| Connection failed | Check command path and environment variables |
| Tools not registered | Check `toolFilter` configuration |
| Environment variables not working | `env` values must be strings |

## Development

```bash
npm install && npm run build
```

MIT License
