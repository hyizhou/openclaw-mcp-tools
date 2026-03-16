/**
 * MCP Tool Bridge - OpenClaw Plugin
 *
 * Bridges MCP server tools as native OpenClaw tools.
 * Enables direct AI invocation without skill or mcporter intermediaries.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { McpClientManager } from "./mcp-client.js";
import { ToolRegistry } from "./tool-registry.js";
import type { McpToolBridgeConfig, McpServerConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

// ============================================================================
// Plugin Definition
// ============================================================================

let clientManager: McpClientManager | null = null;
let toolRegistry: ToolRegistry | null = null;

const mcpToolBridgePlugin = {
  id: "mcp-tool-bridge",
  name: "MCP Tool Bridge",
  description: "Bridges MCP server tools as native OpenClaw tools for direct AI invocation",

  register(api: OpenClawPluginApi) {
    // Parse configuration
    const rawConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const config: McpToolBridgeConfig = {
      servers: (rawConfig.servers as McpServerConfig[]) ?? [],
      autoReconnect: (rawConfig.autoReconnect as boolean | undefined) ?? DEFAULT_CONFIG.autoReconnect,
      reconnectDelayMs: (rawConfig.reconnectDelayMs as number | undefined) ?? DEFAULT_CONFIG.reconnectDelayMs,
      toolCallTimeoutMs: (rawConfig.toolCallTimeoutMs as number | undefined) ?? DEFAULT_CONFIG.toolCallTimeoutMs,
    };

    if (config.servers.length === 0) {
      api.logger.warn("mcp-tool-bridge: no MCP servers configured");
      return;
    }

    // Initialize client manager
    clientManager = new McpClientManager(api.logger, {
      autoReconnect: config.autoReconnect,
      reconnectDelayMs: config.reconnectDelayMs,
    });

    // Initialize tool registry
    toolRegistry = new ToolRegistry(clientManager, api.logger, {
      toolCallTimeoutMs: config.toolCallTimeoutMs,
    });

    api.logger.info(`mcp-tool-bridge: initializing with ${config.servers.length} server(s)`);

    // Register service for lifecycle management (async start)
    api.registerService({
      id: "mcp-tool-bridge",
      start: async (ctx) => {
        // Connect to all enabled servers
        const enabledServers = config.servers.filter((s) => s.enabled !== false);

        for (const serverConfig of enabledServers) {
          try {
            await clientManager!.connect(serverConfig);
          } catch (error) {
            ctx.logger.error(
              `mcp-tool-bridge: failed to connect to "${serverConfig.name}": ${String(error)}`
            );
          }
        }

        // Get connections AFTER connecting
        const connections = clientManager!.getConnections();

        // Register all tools from connected servers
        const toolDefinitions = toolRegistry!.createToolDefinitions();

        for (const { toolInfo, toolDefinition } of toolDefinitions) {
          try {
            api.registerTool({
              name: toolDefinition.name,
              description: toolDefinition.description,
              parameters: toolDefinition.parameters,
              execute: toolDefinition.execute,
            });
          } catch (error) {
            ctx.logger.error(
              `mcp-tool-bridge: failed to register tool "${toolInfo.registeredName}": ${String(error)}`
            );
          }
        }

        // Print summary
        ctx.logger.info("=== MCP Tool Bridge 状态 ===");
        ctx.logger.info(`  已配置服务器: ${config.servers.length}`);
        ctx.logger.info(`  已连接服务器: ${connections.size}`);
        ctx.logger.info(`  已注册工具: ${toolDefinitions.length}`);

        if (connections.size > 0) {
          ctx.logger.info("  --- 已加载工具 ---");
          for (const [serverName, conn] of connections) {
            ctx.logger.info(`  [${serverName}] (${conn.tools.length} 个工具)`);
            for (const tool of conn.tools) {
              ctx.logger.info(`    • ${tool.registeredName}`);
            }
          }
        }

        if (connections.size < enabledServers.length) {
          ctx.logger.info("  --- 连接失败 ---");
          for (const serverConfig of enabledServers) {
            if (!connections.has(serverConfig.name)) {
              ctx.logger.info(`    ✗ ${serverConfig.name}`);
            }
          }
        }
        ctx.logger.info("=========================");
      },
      stop: async (ctx) => {
        ctx.logger.info("mcp-tool-bridge: service stopping...");
        if (clientManager) {
          await clientManager.disconnectAll();
        }
        if (toolRegistry) {
          toolRegistry.clear();
        }
      },
    });

    // Register hook for session end cleanup
    api.on("session_end", async (_event, _ctx) => {
      // Optionally cleanup on session end
      // For now, we keep connections alive across sessions
    });
  },
};

export default mcpToolBridgePlugin;
