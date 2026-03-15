/**
 * Type definitions for mcp-tool-bridge plugin
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// ============================================================================
// Server Configuration Types
// ============================================================================

export type McpTransportType = "stdio" | "sse" | "streamableHttp";

export interface McpServerConfig {
  /** Unique name for this MCP server */
  name: string;
  /** Transport type */
  type: McpTransportType;
  /** Command to run (for stdio transport) */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Server URL (for http/sse/streamableHttp transport) */
  url?: string;
  /** HTTP headers (for streamableHttp transport) */
  headers?: Record<string, string>;
  /** Whether this server is enabled (default: true) */
  enabled?: boolean;
  /** Optional prefix for tool names */
  toolPrefix?: string;
  /** Optional list of tool names to include */
  toolFilter?: string[];
}

export interface McpToolBridgeConfig {
  /** List of MCP servers to connect */
  servers: McpServerConfig[];
  /** Automatically reconnect on disconnect */
  autoReconnect?: boolean;
  /** Delay before reconnecting in milliseconds */
  reconnectDelayMs?: number;
  /** Timeout for tool calls in milliseconds */
  toolCallTimeoutMs?: number;
}

// ============================================================================
// MCP Client Types
// ============================================================================

export interface McpServerConnection {
  /** Server configuration */
  config: McpServerConfig;
  /** MCP client instance */
  client: import("@modelcontextprotocol/sdk/client/index.js").Client;
  /** Transport instance */
  transport: Transport;
  /** Connection state */
  connected: boolean;
  /** Available tools from this server */
  tools: McpToolInfo[];
  /** Last error if any */
  lastError?: Error;
}

export interface McpToolInfo {
  /** Original tool name from MCP server */
  originalName: string;
  /** Registered tool name (with prefix if configured) */
  registeredName: string;
  /** Server name this tool belongs to */
  serverName: string;
  /** Tool definition from MCP */
  definition: Tool;
  /** Input schema as JSON Schema (for OpenClaw) */
  inputSchema?: Record<string, unknown>;
}

// ============================================================================
// Tool Execution Types
// ============================================================================

export interface McpToolCallContext {
  /** Server name */
  serverName: string;
  /** Tool name */
  toolName: string;
  /** Tool call ID */
  toolCallId: string;
  /** Parameters passed to the tool */
  params: Record<string, unknown>;
}

export interface McpToolCallResult {
  /** Result content */
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  /** Whether the tool call resulted in an error */
  isError?: boolean;
}

// ============================================================================
// Plugin Logger (used internally)
// ============================================================================

export interface PluginLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: Required<
  Omit<McpToolBridgeConfig, "servers">
> = {
  autoReconnect: true,
  reconnectDelayMs: 5000,
  toolCallTimeoutMs: 60000,
};
