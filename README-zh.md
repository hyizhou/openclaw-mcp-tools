# OpenClaw MCP Tools

[![npm version](https://img.shields.io/npm/v/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools) [![npm license](https://img.shields.io/npm/l/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools) [![npm downloads](https://img.shields.io/npm/dt/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools)

将 MCP 服务器的工具直接注册为 OpenClaw 原生工具，AI 无需通过 CLI 即可调用。

## 为什么不用官方的 mcporter？

OpenClaw 官方通过 [mcporter](https://mcporter.dev) skill 支持 MCP，但他有如下缺点：
1. 它是间接调用，`AI → 读取mcporter skill  → shell命令 → mcporter CLI → MCP服务器`
2. MCP提供的工具无法被Agent直接看到，需要主动在 TOOLS.md 文档中记录模型所能使用的工具列表。

**本插件的优势**：

| | mcporter (官方) | OpenClaw MCP Tools (本插件) |
|---|---|---|
| 调用方式 | AI 执行 shell 命令 | AI 直接调用原生工具 |
| 延迟 | 需启动 CLI 进程 | 直接调用，无额外开销 |
| 工具描述 | AI 需学习 mcporter 语法 | 工具 schema 直接可见 |
| 依赖 | 需安装 mcporter CLI | 无额外依赖 |

简单说：**mcporter 是"教 AI 用锤子"，本插件是"直接把锤子放 AI 手里"**。

## 功能

- 🔌 同时连接多个 MCP 服务器
- 🔄 自动重连
- 🏷️ 工具名前缀（避免冲突）
- 🔍 工具过滤
- 📡 支持 stdio / HTTP / SSE 传输
- 🖥️ CLI 命令管理 MCP 连接

## CLI 命令

OpenClaw MCP Tools 提供 CLI 命令来管理 MCP 服务器：

```bash
openclaw mcp <command> [options]
```

### 可用命令

| 命令 | 说明 |
|------|------|
| `list` | 列出配置的 MCP 服务器 |
| `tools` | 列出已连接服务器上可用的 MCP 工具 |
| `status` | 显示 MCP 连接状态和统计信息 |
| `call <server> <tool> [args]` | 使用 JSON 参数调用 MCP 工具 |
| `connect <server>` | 连接到配置的 MCP 服务器 |
| `disconnect <server>` | 断开与 MCP 服务器的连接 |
| `reload [server]` | 重新加载 MCP 服务器连接 |

### 使用示例

```bash
# 列出所有配置的服务器
openclaw mcp list

# JSON 格式输出
openclaw mcp list --json

# 查看连接状态
openclaw mcp status

# 列出可用工具
openclaw mcp tools
openclaw mcp tools --server github

# 调用工具
openclaw mcp call github search_repositories '{"query": "mcp"}'

# 管理连接
openclaw mcp connect github
openclaw mcp disconnect github
openclaw mcp reload github
openclaw mcp reload  # 重载所有服务器
```

### 独立测试

无需安装到 OpenClaw 即可测试 CLI 命令：

```bash
# 创建配置文件
cp mcp-config.example.json mcp-config.json

# 运行命令
npx tsx src/cli.ts mcp --help
npx tsx src/cli.ts mcp list
npx tsx src/cli.ts mcp status --json
```

或使用环境变量：

```bash
MCP_SERVERS='[{"name":"test","type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}]' \
npx tsx src/cli.ts mcp status
```

## 安装

```bash
# 本地链接
openclaw plugins install -l ./openclaw-mcp-tools

# 或 npm 安装
openclaw plugins install openclaw-mcp-tools
```

## 配置

在 OpenClaw 配置文件 (`~/.openclaw/openclaw.json`) 中添加：

### stdio 传输（本地进程）

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

### streamableHttp 传输（远程服务器）

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

### 服务器配置

配置路径：`plugins.entries.openclaw-mcp-tools.config.servers[]`

| 字段 | 必填 | 适用传输 | 说明 |
|------|------|----------|------|
| `name` | ✅ | 全部 | 服务器唯一标识 |
| `type` | ✅ | 全部 | `stdio` / `sse` / `streamableHttp` |
| `enabled` | ❌ | 全部 | 是否启用，默认 `true` |
| `toolPrefix` | ❌ | 全部 | 工具名前缀，如 `web_` |
| `toolFilter` | ❌ | 全部 | 只加载指定工具，数组格式 |
| `command` | ✅* | `stdio` | 启动命令，如 `npx` |
| `args` | ❌ | `stdio` | 命令参数，数组格式 |
| `env` | ❌ | `stdio` | 环境变量，如 `{ "GITHUB_TOKEN": "ghp_xxx" }` |
| `url` | ✅* | `sse` / `streamableHttp` | 服务器地址 |
| `headers` | ❌ | `streamableHttp` | HTTP 请求头，如 `{ "Authorization": "Bearer xxx" }` |

> *`command` 在 `stdio` 传输下必填；`url` 在 `sse` / `streamableHttp` 传输下必填。

### 全局配置

配置路径：`plugins.entries.openclaw-mcp-tools.config`

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `autoReconnect` | `true` | 断开后自动重连 |
| `reconnectDelayMs` | `5000` | 重连延迟（毫秒） |
| `toolCallTimeoutMs` | `60000` | 工具调用超时（毫秒） |

## 故障排除

### 工具调用超时

当 MCP 工具响应时间较长（如识图工具），可能超出默认 60 秒超时。在全局配置中调大：

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

注意：OpenClaw 本身也可能有工具调用超时限制，如有需要两边都要调大。

### 工具名称冲突

当多个 MCP 服务器暴露同名工具时，插件会自动将后出现的重命名为 `serverName.toolName`（如 `github.web-search`）以避免冲突。你也可以使用 `toolPrefix` 手动避免冲突：

```json
{
  "servers": [
    { "name": "server-a", "toolPrefix": "a_", ... },
    { "name": "server-b", "toolPrefix": "b_", ... }
  ]
}
```

### 其他问题

| 问题 | 解决 |
|------|------|
| 连接失败 | 检查 command 路径和环境变量 |
| 工具未注册 | 检查 toolFilter 配置 |
| 环境变量未生效 | env 值必须是字符串 |

## 开发

```bash
npm install && npm run build
```

MIT License
