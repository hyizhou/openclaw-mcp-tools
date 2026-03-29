/**
 * MCP Tool Bridge - OpenClaw Plugin
 *
 * Bridges MCP server tools as native OpenClaw tools.
 * Enables direct AI invocation without skill or mcporter intermediaries.
 */

import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { McpClientManager } from "./mcp-client.js";
import { ToolRegistry } from "./tool-registry.js";
import { registerMcpCli } from "./mcp-cli.js";
import type { McpToolBridgeConfig, McpServerConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

// ============================================================================
// Gateway Handler Types
// ============================================================================

type GatewayHandlerOpts = {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code?: string; message?: string }) => void;
};

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

export default definePluginEntry({
  id: "openclaw-mcp-tools",
  name: "MCP Tool Bridge",
  description: "Bridges MCP server tools as native OpenClaw tools for direct AI invocation",

  configSchema: Type.Object({
    servers: Type.Array(Type.Object({
      name: Type.String(),
      type: Type.Union([
        Type.Literal("stdio"),
        Type.Literal("sse"),
        Type.Literal("streamableHttp"),
      ]),
      command: Type.Optional(Type.String()),
      args: Type.Optional(Type.Array(Type.String())),
      env: Type.Optional(Type.Record(Type.String(), Type.String())),
      url: Type.Optional(Type.String()),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      enabled: Type.Optional(Type.Boolean()),
      toolPrefix: Type.Optional(Type.String()),
      toolFilter: Type.Optional(Type.Array(Type.String())),
    })),
    autoReconnect: Type.Optional(Type.Boolean()),
    reconnectDelayMs: Type.Optional(Type.Number()),
    toolCallTimeoutMs: Type.Optional(Type.Number()),
  }),

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
      api.logger.warn("openclaw-mcp-tools: no MCP servers configured");
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

      api.logger.debug?.(`openclaw-mcp-tools: initializing with ${config.servers.length} server(s)`);
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
      id: "openclaw-mcp-tools",
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
          ctx.logger.error(`openclaw-mcp-tools: initial connection error: ${String(error)}`);
        }

        // Print status after initial connection attempt
        printStatus(config, ctx.logger);
      },
      stop: async (ctx) => {
        ctx.logger.debug?.("openclaw-mcp-tools: service stopping...");
        if (clientManager) {
          await clientManager.disconnectAll();
        }
        if (toolRegistry) {
          toolRegistry.clear();
        }
      },
    });

    // Register CLI commands for MCP management
    api.registerCli(
      (cliCtx) => {
        registerMcpCli(cliCtx, { servers: config.servers });
      },
      { commands: ["mcp"] }
    );

    // Register Gateway methods for CLI to query main process state
    registerGatewayHandlers(api, config);
  },
});

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
      logger.debug?.(`openclaw-mcp-tools: connected to "${serverConfig.name}"`);
    } catch (error) {
      logger.error(
        `openclaw-mcp-tools: failed to connect to "${serverConfig.name}": ${String(error)}`
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
    logger.warn("openclaw-mcp-tools: toolRegistry or clientManager not initialized");
    return [];
  }

  const connections = clientManager.getConnections();
  if (connections.size === 0) {
    logger.debug?.("openclaw-mcp-tools: no MCP connections available yet");
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
        `openclaw-mcp-tools: failed to create tool "${toolInfo.registeredName}": ${String(error)}`
      );
    }
  }

  logger.debug?.(`openclaw-mcp-tools: returning ${tools.length} tools`);
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

  logger.info("=== OpenClaw MCP Tools ===");
  logger.info(`  configured: ${config.servers.length}, connected: ${connections.size}, tools: ${totalTools}`);

  if (connections.size > 0) {
    for (const [serverName, conn] of connections) {
      const toolNames = conn.tools.map((t: { registeredName: string }) => t.registeredName).join(", ");
      logger.info(`  [${serverName}] (${conn.tools.length}) ${toolNames}`);
    }
  }

  if (connections.size < enabledServers.length) {
    const pending = enabledServers
      .filter((s) => !connections.has(s.name))
      .map((s) => s.name)
      .join(", ");
    logger.info(`  pending: ${pending}`);
  }
  logger.info("=========================");
}

// ============================================================================
// Gateway Methods
// ============================================================================

/**
 * Register Gateway methods that allow CLI to query main process state.
 * These run in the main process where MCP connections are active.
 */
function registerGatewayHandlers(
  api: OpenClawPluginApi,
  config: McpToolBridgeConfig
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (method: string, fn: (opts: GatewayHandlerOpts) => void) => {
    api.registerGatewayMethod(method, fn as any);
  };

  // mcp.list - List configured servers with real connection status
  handler("mcp.list", (opts) => {
    const connections = clientManager?.getConnections() ?? new Map();
    const result = config.servers.map((server) => {
      const conn = connections.get(server.name);
      return {
        name: server.name,
        type: server.type,
        enabled: server.enabled !== false,
        connected: conn?.connected ?? false,
        toolCount: conn?.tools?.length ?? 0,
        error: conn?.lastError?.message,
      };
    });
    opts.respond(true, result);
  });

  // mcp.tools - List available tools from connected servers
  handler("mcp.tools", (opts) => {
    const serverFilter = opts.params.server as string | undefined;
    const connections = clientManager?.getConnections() ?? new Map();
    const tools: Array<{ name: string; server: string; originalName: string }> = [];

    for (const [serverName, conn] of connections) {
      if (!conn.connected) continue;
      if (serverFilter && serverName !== serverFilter) continue;
      for (const tool of conn.tools) {
        tools.push({
          name: tool.registeredName,
          server: serverName,
          originalName: tool.originalName,
        });
      }
    }
    opts.respond(true, tools);
  });
}
