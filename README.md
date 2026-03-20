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
- CLI commands for MCP management

## CLI Commands

OpenClaw MCP Tools provides CLI commands to manage MCP servers:

```bash
openclaw mcp <command> [options]
```

### Available Commands

| Command | Description |
|---------|-------------|
| `list` | List configured MCP servers |
| `tools` | List available MCP tools from connected servers |
| `status` | Show MCP connection status and statistics |
| `call <server> <tool> [args]` | Call an MCP tool with JSON arguments |
| `connect <server>` | Connect to a configured MCP server |
| `disconnect <server>` | Disconnect from an MCP server |
| `reload [server]` | Reload MCP server connections |

### Examples

```bash
# List all configured servers
openclaw mcp list

# List with JSON output
openclaw mcp list --json

# Show connection status
openclaw mcp status

# List available tools
openclaw mcp tools
openclaw mcp tools --server github

# Call a tool
openclaw mcp call github search_repositories '{"query": "mcp"}'

# Manage connections
openclaw mcp connect github
openclaw mcp disconnect github
openclaw mcp reload github
openclaw mcp reload  # Reload all servers
```

### Standalone Testing

You can test CLI commands without installing into OpenClaw:

```bash
# Create config file (for standalone testing only)
cp standalone-test-config.example.json standalone-test-config.json

# Edit config as needed, then run
npx tsx src/cli.ts mcp --help
npx tsx src/cli.ts mcp list
npx tsx src/cli.ts mcp status --json
```

Or use environment variable:

```bash
MCP_SERVERS='[{"name":"test","type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}]' \
npx tsx src/cli.ts mcp status
```

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

### Performance Tips

> **Too many tools may degrade model performance.** Each MCP server can expose dozens of tools, and the model must process all tool schemas on every request. Consider:
>
> 1. **Use `toolFilter`** to only load the tools you need from an MCP server:
>    ```json
>    { "name": "github", "toolFilter": ["search_repositories", "get_issue"], ... }
>    ```
>
> 2. **Use `enabled: false`** to temporarily disable a server without deleting config
>
> 3. **Block tools in OpenClaw config** - Add tool names to `tools.deny` array in your OpenClaw configuration:
>    ```json
>    "tools": {
>      "deny": ["mcp_tool_name_to_block", "another_tool"]
>    }
>    ```

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
