# OpenClaw MCP Tools

> **提示：** OpenClaw `2026.3.22` 及以上版本已内置原生 MCP 支持，无需安装本插件。直接通过 `openclaw mcp set` 命令或在 `~/.openclaw/openclaw.json` 中配置 MCP 服务器即可。对于 `2026.3.22` 之前的版本，推荐使用本插件以获得 MCP 工具桥接能力。

[![npm version](https://img.shields.io/npm/v/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools) [![npm license](https://img.shields.io/npm/l/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools) [![npm downloads](https://img.shields.io/npm/dt/openclaw-mcp-tools)](https://www.npmjs.com/package/openclaw-mcp-tools)

将 MCP 服务器的工具直接注册为 OpenClaw 原生工具，AI 无需通过 CLI 即可调用。

> **版本兼容性：** `2.0.0` 适用于 OpenClaw **2026.3.22** 及以上版本（新版插件 SDK）。更早的 OpenClaw 版本请使用 `1.x`。

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

OpenClaw MCP Tools 提供 CLI 命令查看 MCP 服务器状态：

> **v2.0.0** 将命令从 `mcp` 重命名为 `mcp-tools`，以避免与 OpenClaw 内置的 `mcp` 命令冲突。如果你使用的是 **v1.x**，请将下方所有命令中的 `mcp-tools` 替换为 `mcp`。

```bash
openclaw mcp-tools <command> [options]
```

### 可用命令

| 命令 | 说明 |
|------|------|
| `list` | 列出配置的 MCP 服务器及连接状态 |
| `tools` | 列出已连接服务器上可用的 MCP 工具 |

### 使用示例

```bash
# 列出所有配置的服务器
openclaw mcp-tools list

# JSON 格式输出
openclaw mcp-tools list --json

# 列出可用工具
openclaw mcp-tools tools
openclaw mcp-tools tools --server github
openclaw mcp-tools tools --json
```

### 独立测试

无需安装到 OpenClaw 即可测试 CLI 命令：

```bash
# 创建配置文件（仅用于独立测试）
cp standalone-test-config.example.json standalone-test-config.json

# 运行命令
npx tsx src/cli.ts mcp-tools --help
npx tsx src/cli.ts mcp-tools list
npx tsx src/cli.ts mcp-tools tools
```

或使用环境变量：

```bash
MCP_SERVERS='[{"name":"test","type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}]' \
npx tsx src/cli.ts mcp-tools list
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

### 性能提示

> **工具过多可能导致模型性能下降。** 每个 MCP 服务器可能暴露数十个工具，模型需要在每次请求时处理所有工具的 schema。建议：
>
> 1. **使用 `toolFilter`** 只加载需要的工具：
>    ```json
>    { "name": "github", "toolFilter": ["search_repositories", "get_issue"], ... }
>    ```
>
> 2. **使用 `enabled: false`** 临时禁用服务器而不删除配置
>
> 3. **在 OpenClaw 配置中屏蔽工具** - 在 OpenClaw 配置的 `tools.deny` 数组中添加要屏蔽的工具名：
>    ```json
>    "tools": {
>      "deny": ["要屏蔽的mcp工具名", "另一个工具"]
>    }
>    ```

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
