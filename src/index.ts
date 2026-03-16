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
// Types (inline to avoid import issues)
// ============================================================================

/**
 * Tool definition compatible with OpenClaw's AnyAgentTool
 */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown
  ) => Promise<unknown>;
}

/**
 * Context passed to tool factory (subset of OpenClawPluginToolContext)
 */
interface ToolContext {
  config?: unknown;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
  sandboxed?: boolean;
}

// ============================================================================
// Plugin State
// ============================================================================

let clientManager: McpClientManager | null = null;
let toolRegistry: ToolRegistry | null = null;
let initPromise: Promise<void> | null = null;

// IMPORTANT: register() may be called multiple times by loadOpenClawPlugins()
// when the plugin registry cache is invalidated. clientManager/toolRegistry
// are guarded to prevent overwriting established MCP connections.
// Service is registered on every call so each registry has its own entry.

// ============================================================================
// Plugin Definition
// ============================================================================

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

    // Only initialize clientManager/toolRegistry once per process.
    // Subsequent register() calls must NOT overwrite these, otherwise
    // MCP connections established by service.start() are lost.
    if (!clientManager) {
      clientManager = new McpClientManager(api.logger, {
        autoReconnect: config.autoReconnect,
        reconnectDelayMs: config.reconnectDelayMs,
      });

      toolRegistry = new ToolRegistry(clientManager, api.logger, {
        toolCallTimeoutMs: config.toolCallTimeoutMs,
      });

      api.logger.info(`mcp-tool-bridge: initializing with ${config.servers.length} server(s)`);
    }

    // Register tool factory function.
    // The factory is called each time tools are resolved, returning
    // currently available tools based on MCP connection status.
    // Use type assertion to bypass compile-time type check since openclaw types
    // may not be fully resolved during standalone plugin compilation.
    const toolFactory = (_context: ToolContext): ToolDefinition[] | undefined => {
      return getAvailableTools(api.logger);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.registerTool(toolFactory as any);

    // Register service for lifecycle management (async start).
    // Each registry needs its own service registration so that
    // startPluginServices() can find and start it.
    api.registerService({
      id: "mcp-tool-bridge",
      start: async (ctx) => {
        // Start MCP connections
        initPromise = connectToMcpServers(config, ctx.logger);

        // Wait for initial connections with a timeout
        // Tools will become available as connections are established
        try {
          await Promise.race([
            initPromise,
            new Promise<void>((resolve) => setTimeout(resolve, 10000)),
          ]);
        } catch (error) {
          ctx.logger.error(`mcp-tool-bridge: initial connection error: ${String(error)}`);
        }

        // Print status after initial connection attempt
        printStatus(config, ctx.logger);
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
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Connect to all enabled MCP servers
 */
async function connectToMcpServers(
  config: McpToolBridgeConfig,
  logger: OpenClawPluginApi["logger"]
): Promise<void> {
  const enabledServers = config.servers.filter((s) => s.enabled !== false);

  for (const serverConfig of enabledServers) {
    try {
      await clientManager!.connect(serverConfig);
      logger.info(`mcp-tool-bridge: connected to "${serverConfig.name}"`);
    } catch (error) {
      logger.error(
        `mcp-tool-bridge: failed to connect to "${serverConfig.name}": ${String(error)}`
      );
    }
  }
}

/**
 * Get currently available tools from connected MCP servers.
 * Called each time the tool factory is invoked.
 */
function getAvailableTools(logger: OpenClawPluginApi["logger"]): ToolDefinition[] {
  if (!toolRegistry || !clientManager) {
    logger.warn("mcp-tool-bridge: toolRegistry or clientManager not initialized");
    return [];
  }

  const connections = clientManager.getConnections();
  if (connections.size === 0) {
    logger.debug?.("mcp-tool-bridge: no MCP connections available yet");
    return [];
  }

  const tools: ToolDefinition[] = [];
  const toolDefinitions = toolRegistry.createToolDefinitions();

  for (const { toolInfo, toolDefinition } of toolDefinitions) {
    try {
      tools.push({
        name: toolDefinition.name,
        description: toolDefinition.description,
        parameters: toolDefinition.parameters,
        execute: toolDefinition.execute,
      });
    } catch (error) {
      logger.error(
        `mcp-tool-bridge: failed to create tool "${toolInfo.registeredName}": ${String(error)}`
      );
    }
  }

  logger.info(`mcp-tool-bridge: returning ${tools.length} tools`);
  return tools;
}

/**
 * Print connection status summary
 */
function printStatus(
  config: McpToolBridgeConfig,
  logger: OpenClawPluginApi["logger"]
): void {
  const connections = clientManager?.getConnections() ?? new Map();
  const enabledServers = config.servers.filter((s) => s.enabled !== false);
  const totalTools = Array.from(connections.values()).reduce(
    (sum, conn) => sum + conn.tools.length,
    0
  );

  logger.info("=== MCP Tool Bridge 状态 ===");
  logger.info(`  已配置服务器: ${config.servers.length}`);
  logger.info(`  已连接服务器: ${connections.size}`);
  logger.info(`  可用工具: ${totalTools}`);

  if (connections.size > 0) {
    logger.info("  --- 已加载工具 ---");
    for (const [serverName, conn] of connections) {
      logger.info(`  [${serverName}] (${conn.tools.length} 个工具)`);
      for (const tool of conn.tools) {
        logger.info(`    • ${tool.registeredName}`);
      }
    }
  }

  if (connections.size < enabledServers.length) {
    logger.info("  --- 连接中/失败 ---");
    for (const serverConfig of enabledServers) {
      if (!connections.has(serverConfig.name)) {
        logger.info(`    ○ ${serverConfig.name}`);
      }
    }
  }
  logger.info("=========================");
}

export default mcpToolBridgePlugin;
