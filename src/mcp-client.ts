/**
 * MCP Client - Manages connections to MCP servers
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  McpServerConfig,
  McpServerConnection,
  McpToolInfo,
  PluginLogger,
  DEFAULT_CONFIG,
} from "./types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// ============================================================================
// MCP Client Manager
// ============================================================================

export class McpClientManager {
  private connections: Map<string, McpServerConnection> = new Map();
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private logger: PluginLogger;
  private autoReconnect: boolean;
  private reconnectDelayMs: number;

  constructor(
    logger: PluginLogger,
    options?: {
      autoReconnect?: boolean;
      reconnectDelayMs?: number;
    }
  ) {
    this.logger = logger;
    this.autoReconnect = options?.autoReconnect ?? true;
    this.reconnectDelayMs = options?.reconnectDelayMs ?? 5000;
  }

  /**
   * Connect to an MCP server
   */
  async connect(config: McpServerConfig): Promise<McpServerConnection> {
    const existingConnection = this.connections.get(config.name);
    if (existingConnection?.connected) {
      this.logger.warn?.(`openclaw-mcp-tools: server "${config.name}" already connected`);
      return existingConnection;
    }

    this.logger.debug?.(`openclaw-mcp-tools: connecting to "${config.name}" (${config.type})`);

    const transport = await this.createTransport(config);
    const client = new Client(
      { name: "openclaw-openclaw-mcp-tools", version: "1.0.0" },
      { capabilities: {} }
    );

    const connection: McpServerConnection = {
      config,
      client,
      transport,
      connected: false,
      tools: [],
    };

    try {
      await client.connect(transport);
      connection.connected = true;
      this.connections.set(config.name, connection);

      // Fetch available tools
      connection.tools = await this.fetchTools(connection);

      this.logger.debug?.(
        `openclaw-mcp-tools: connected to "${config.name}", found ${connection.tools.length} tools`
      );

      // Set up disconnect handler
      transport.onclose = () => {
        this.handleDisconnect(config.name);
      };

      transport.onerror = (error: Error) => {
        this.handleError(config.name, error);
      };

      return connection;
    } catch (error) {
      connection.lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `openclaw-mcp-tools: failed to connect to "${config.name}": ${connection.lastError.message}`
      );
      throw connection.lastError;
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      return;
    }

    // Clear any pending reconnect timer
    const timer = this.reconnectTimers.get(serverName);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(serverName);
    }

    try {
      await connection.client.close();
    } catch (error) {
      this.logger.warn?.(
        `openclaw-mcp-tools: error closing connection to "${serverName}": ${String(error)}`
      );
    }

    connection.connected = false;
    this.connections.delete(serverName);
    this.logger.debug?.(`openclaw-mcp-tools: disconnected from "${serverName}"`);
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.keys()).map((name) =>
      this.disconnect(name)
    );
    await Promise.all(disconnectPromises);
  }

  /**
   * Get all connected servers
   */
  getConnections(): Map<string, McpServerConnection> {
    return new Map(this.connections);
  }

  /**
   * Get a specific connection
   */
  getConnection(serverName: string): McpServerConnection | undefined {
    return this.connections.get(serverName);
  }

  /**
   * Get all tools from all connected servers
   */
  getAllTools(): McpToolInfo[] {
    const allTools: McpToolInfo[] = [];
    for (const connection of this.connections.values()) {
      if (connection.connected) {
        allTools.push(...connection.tools);
      }
    }
    return allTools;
  }

  /**
   * Call a tool on an MCP server
   */
  async callTool(
    serverName: string,
    toolName: string,
    params: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<unknown> {
    const connection = this.connections.get(serverName);
    if (!connection || !connection.connected) {
      throw new Error(`MCP server "${serverName}" is not connected`);
    }

    const timeout = timeoutMs ?? 60000;

    try {
      const result = await connection.client.callTool(
        {
          name: toolName,
          arguments: params,
        },
        undefined,
        { timeout }
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `openclaw-mcp-tools: tool call failed on "${serverName}/${toolName}": ${errorMessage}`
      );
      throw error;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async createTransport(config: McpServerConfig): Promise<Transport> {
    switch (config.type) {
      case "stdio": {
        if (!config.command) {
          throw new Error(`stdio transport requires "command" for server "${config.name}"`);
        }
        // Filter out undefined values from process.env
        const filteredEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) {
            filteredEnv[key] = value;
          }
        }
        const mergedEnv = config.env ? { ...filteredEnv, ...config.env } : filteredEnv;

        return new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: mergedEnv,
        });
      }

      case "sse": {
        if (!config.url) {
          throw new Error(`sse transport requires "url" for server "${config.name}"`);
        }
        return new SSEClientTransport(
          new URL(config.url),
          {}
        );
      }

      case "streamableHttp": {
        // Streamable HTTP is the recommended transport for remote MCP servers
        if (!config.url) {
          throw new Error(`streamableHttp transport requires "url" for server "${config.name}"`);
        }
        return new StreamableHTTPClientTransport(
          new URL(config.url),
          {
            requestInit: {
              headers: config.headers,
            },
          }
        );
      }

      default:
        throw new Error(`Unknown transport type: ${config.type}`);
    }
  }

  private async fetchTools(connection: McpServerConnection): Promise<McpToolInfo[]> {
    try {
      const result = await connection.client.listTools();
      const tools: McpToolInfo[] = [];
      const prefix = connection.config.toolPrefix ?? "";

      for (const tool of result.tools) {
        // Apply tool filter if configured
        if (connection.config.toolFilter?.length) {
          if (!connection.config.toolFilter.includes(tool.name)) {
            continue;
          }
        }

        const registeredName = prefix + tool.name;
        tools.push({
          originalName: tool.name,
          registeredName,
          serverName: connection.config.name,
          definition: tool,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }

      return tools;
    } catch (error) {
      this.logger.error(
        `openclaw-mcp-tools: failed to fetch tools from "${connection.config.name}": ${String(error)}`
      );
      return [];
    }
  }

  private handleDisconnect(serverName: string): void {
    const connection = this.connections.get(serverName);
    if (connection) {
      connection.connected = false;
      this.logger.warn?.(`openclaw-mcp-tools: server "${serverName}" disconnected`);
    }

    if (this.autoReconnect && connection?.config) {
      this.scheduleReconnect(connection.config);
    }
  }

  private handleError(serverName: string, error: Error): void {
    const connection = this.connections.get(serverName);
    if (connection) {
      connection.lastError = error;
    }
    this.logger.error(`openclaw-mcp-tools: transport error on "${serverName}": ${error.message}`);
  }

  private scheduleReconnect(config: McpServerConfig): void {
    // Clear any existing timer
    const existingTimer = this.reconnectTimers.get(config.name);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.logger.debug?.(
      `openclaw-mcp-tools: scheduling reconnect to "${config.name}" in ${this.reconnectDelayMs}ms`
    );

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(config.name);
      try {
        await this.connect(config);
      } catch (error) {
        this.logger.warn?.(
          `openclaw-mcp-tools: reconnect failed for "${config.name}": ${String(error)}`
        );
        // Schedule another reconnect attempt
        if (this.autoReconnect) {
          this.scheduleReconnect(config);
        }
      }
    }, this.reconnectDelayMs);

    this.reconnectTimers.set(config.name, timer);
  }
}
