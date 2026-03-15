# MCP Tool Bridge - OpenClaw 插件

将 MCP (Model Context Protocol) 服务器的工具桥接到 OpenClaw，使其成为 OpenClaw 原生工具，可直接被 AI 调用。

## 功能特点

- 🔌 **多服务器支持** - 同时连接多个 MCP 服务器
- 🔄 **自动重连** - 连接断开后自动重连
- 🏷️ **工具名前缀** - 避免不同服务器的工具名冲突
- 🔍 **工具过滤** - 只加载需要的工具
- ⚡ **原生集成** - 无需 skill 或 mcporter 中间层
- 📡 **多传输协议** - 支持 stdio、HTTP、SSE

## 安装

### 方式 1: 本地链接

```bash
# 在 OpenClaw 工作区
openclaw plugins install -l ./mcp-tool-bridge
```

### 方式 2: npm 安装

```bash
openclaw plugins install @openclaw/mcp-tool-bridge
```

### 方式 3: 手动安装

```bash
cd ~/.openclaw/workspace
git clone <repo-url> mcp-tool-bridge
cd mcp-tool-bridge
npm install
npm run build
```

## 配置

在 OpenClaw 配置文件 (`~/.openclaw/openclaw.json`) 中添加：

```json
{
  "plugins": {
    "entries": {
      "mcp-tool-bridge": {
        "enabled": true,
        "config": {
          "servers": [
            {
              "name": "filesystem",
              "type": "stdio",
              "command": "npx",
              "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"],
              "enabled": true
            }
          ]
        }
      }
    }
  }
}
```

## 服务器配置说明

### 基础字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 服务器唯一标识名 |
| `type` | string | ✅ | 传输类型: `stdio` / `sse` / `streamableHttp` |
| `enabled` | boolean | ❌ | 是否启用，默认 `true` |
| `toolPrefix` | string | ❌ | 工具名前缀，如 `web_` |
| `toolFilter` | string[] | ❌ | 只加载指定的工具 |

### stdio 传输（本地进程）

```json
{
  "name": "filesystem",
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
  "env": {
    "CUSTOM_VAR": "value"
  }
}
```

| 字段 | 说明 |
|------|------|
| `command` | 可执行命令 (npx, uvx, python, node 等) |
| `args` | 命令行参数 |
| `env` | 环境变量 |

### sse 传输（远程服务器 - 旧版）

```json
{
  "name": "remote-tools",
  "type": "sse",
  "url": "http://localhost:3000/sse"
}
```

| 字段 | 说明 |
|------|------|
| `url` | MCP 服务器地址 |

> ⚠️ `sse` 传输类型已被官方标记为过时，建议使用 `streamableHttp`

### streamableHttp 传输（远程服务器 - 推荐）

```json
{
  "name": "remote-tools",
  "type": "streamableHttp",
  "url": "http://localhost:3000/mcp",
  "headers": {
    "Authorization": "Bearer your_api_key"
  }
}
```

| 字段 | 说明 |
|------|------|
| `url` | MCP 服务器地址（支持 Streamable HTTP 协议） |
| `headers` | HTTP 请求头（如 Authorization） |

> ✅ `streamableHttp` 是官方推荐的远程 MCP 服务器传输方式，支持更好的流式响应和双向通信

## 全局配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `autoReconnect` | boolean | `true` | 断开后是否自动重连 |
| `reconnectDelayMs` | number | `5000` | 重连延迟（毫秒） |
| `toolCallTimeoutMs` | number | `60000` | 工具调用超时（毫秒） |

## 完整配置示例

### 示例 1: 单个 MCP 服务器

```json
{
  "plugins": {
    "entries": {
      "mcp-tool-bridge": {
        "enabled": true,
        "config": {
          "servers": [
            {
              "name": "web-search",
              "type": "stdio",
              "command": "uvx",
              "args": ["mcp-server-web-search"]
            }
          ]
        }
      }
    }
  }
}
```

### 示例 2: 多个 MCP 服务器 + 前缀

```json
{
  "plugins": {
    "entries": {
      "mcp-tool-bridge": {
        "enabled": true,
        "config": {
          "servers": [
            {
              "name": "web",
              "type": "stdio",
              "command": "uvx",
              "args": ["mcp-server-web-search"],
              "toolPrefix": "web_"
            },
            {
              "name": "github",
              "type": "stdio",
              "command": "npx",
              "args": ["-y", "@modelcontextprotocol/server-github"],
              "env": {
                "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx"
              },
              "toolPrefix": "gh_"
            },
            {
              "name": "slack",
              "type": "stdio",
              "command": "npx",
              "args": ["-y", "@modelcontextprotocol/server-slack"],
              "env": {
                "SLACK_BOT_TOKEN": "xoxb-xxxxxxxx",
                "SLACK_TEAM_ID": "TXXXXXXXX"
              },
              "toolPrefix": "slack_"
            }
          ],
          "autoReconnect": true,
          "reconnectDelayMs": 5000,
          "toolCallTimeoutMs": 60000
        }
      }
    }
  }
}
```

配置后工具名会变成：
- `web_search` - 来自 web-search 服务器
- `gh_create_issue` - 来自 github 服务器
- `slack_send_message` - 来自 slack 服务器

### 示例 3: 远程 MCP + 工具过滤

```json
{
  "plugins": {
    "entries": {
      "mcp-tool-bridge": {
        "enabled": true,
        "config": {
          "servers": [
            {
              "name": "remote",
              "type": "sse",
              "url": "http://192.168.1.100:3000/sse",
              "toolFilter": ["search", "get_item"],
              "toolPrefix": "remote_"
            }
          ]
        }
      }
    }
  }
}
```

只加载 `search` 和 `get_item` 两个工具。

### 示例 4: Python MCP 服务器

```json
{
  "name": "python-tools",
  "type": "stdio",
  "command": "uv",
  "args": ["--directory", "/path/to/server", "run", "server.py"],
  "env": {
    "PYTHONUNBUFFERED": "1"
  }
}
```

## 常见 MCP 服务器

| 服务器 | 安装命令 | 说明 |
|--------|---------|------|
| Filesystem | `npx -y @modelcontextprotocol/server-filesystem` | 文件系统操作 |
| GitHub | `npx -y @modelcontextprotocol/server-github` | GitHub API |
| Slack | `npx -y @modelcontextprotocol/server-slack` | Slack 集成 |
| Postgres | `npx -y @modelcontextprotocol/server-postgres` | PostgreSQL 数据库 |
| SQLite | `npx -y @modelcontextprotocol/server-sqlite` | SQLite 数据库 |
| Puppeteer | `npx -y @modelcontextprotocol/server-puppeteer` | 浏览器自动化 |
| Brave Search | `npx -y @modelcontextprotocol/server-brave-search` | Brave 搜索 |
| Memory | `npx -y @modelcontextprotocol/server-memory` | 知识图谱内存 |

## 工作原理

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   MCP Server    │────▶│  MCP Tool Bridge│────▶│    OpenClaw     │
│  (提供工具)      │     │    (插件)        │     │   (AI 调用)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │   stdio/sse/http      │   registerTool()
        │                       │   inputSchema + handler
        ▼                       ▼
   MCP 协议通信            OpenClaw 原生工具格式
```

1. 插件启动时连接配置的 MCP 服务器
2. 获取每个服务器的工具列表
3. 将 MCP 工具转换为 OpenClaw 原生工具格式
4. AI 可以直接调用这些工具，无需中间层

## 调试

启用详细日志：

```bash
openclaw start --verbose
```

检查插件状态：

```bash
openclaw plugins doctor
```

### 常见问题

| 问题 | 解决方案 |
|------|---------|
| 连接失败 | 检查 command 路径和环境变量 |
| 工具未注册 | 检查 toolFilter 配置 |
| 超时错误 | 增加 toolCallTimeoutMs 值 |
| 环境变量未生效 | 确保 env 中值都是字符串 |

## 开发

```bash
# 安装依赖
npm install

# 开发模式 (监听变化)
npm run dev

# 构建
npm run build

# 清理
npm run clean
```

## 项目结构

```
src/
├── index.ts                   # 插件入口，处理配置和注册
├── mcp-client.ts              # MCP 客户端管理，连接/断开/重连
├── tool-registry.ts           # 工具注册，MCP → OpenClaw 格式转换
├── types.ts                   # 类型定义
└── openclaw-plugin-sdk.d.ts   # OpenClaw SDK 类型声明
```

## 许可证

MIT
