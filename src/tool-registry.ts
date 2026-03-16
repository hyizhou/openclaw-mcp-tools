/**
 * Tool Registry - Converts MCP tools to OpenClaw tools
 */

import type { McpClientManager } from "./mcp-client.js";
import type { McpToolInfo, McpToolCallResult, PluginLogger } from "./types.js";

// ============================================================================
// Tool Registry
// ============================================================================

export class ToolRegistry {
  private clientManager: McpClientManager;
  private logger: PluginLogger;
  private registeredTools: Map<string, McpToolInfo> = new Map();
  private toolCallTimeoutMs: number;

  constructor(
    clientManager: McpClientManager,
    logger: PluginLogger,
    options?: { toolCallTimeoutMs?: number }
  ) {
    this.clientManager = clientManager;
    this.logger = logger;
    this.toolCallTimeoutMs = options?.toolCallTimeoutMs ?? 60000;
  }

  /**
   * Create OpenClaw tool definitions from MCP tools
   */
  createToolDefinitions(): Array<{
    toolInfo: McpToolInfo;
    toolDefinition: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      execute: (toolCallId: string, args: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown) => Promise<McpToolCallResult>;
    };
  }> {
    const tools = this.clientManager.getAllTools();
    const definitions: Array<{
      toolInfo: McpToolInfo;
      toolDefinition: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        execute: (toolCallId: string, args: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown) => Promise<McpToolCallResult>;
      };
    }> = [];

    for (const toolInfo of tools) {
      // Skip if already registered
      if (this.registeredTools.has(toolInfo.registeredName)) {
        continue;
      }

      const definition = this.createToolDefinition(toolInfo);
      definitions.push({ toolInfo, toolDefinition: definition });
      this.registeredTools.set(toolInfo.registeredName, toolInfo);
    }

    return definitions;
  }

  /**
   * Create a single tool definition
   */
  private createToolDefinition(toolInfo: McpToolInfo): {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, args: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown) => Promise<McpToolCallResult>;
  } {
    const { serverName, originalName, registeredName, definition } = toolInfo;

    // Use MCP inputSchema as parameters (it's already JSON Schema)
    const parameters = definition.inputSchema as Record<string, unknown> ?? {
      type: "object",
      properties: {},
    };

    // Build description with server info
    let description = definition.description ?? `MCP tool: ${originalName}`;
    if (!description.includes(`[${serverName}]`)) {
      description = `[${serverName}] ${description}`;
    }

    return {
      name: registeredName,
      description,
      parameters,
      execute: async (_toolCallId: string, args: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown) => {
        return this.executeToolCall(serverName, originalName, args);
      },
    };
  }

  /**
   * Execute a tool call on the MCP server
   */
  private async executeToolCall(
    serverName: string,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    try {
      const result = await this.clientManager.callTool(
        serverName,
        toolName,
        params,
        this.toolCallTimeoutMs
      );

      // Convert MCP result to our format
      return this.convertResult(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`mcp-tool-bridge: tool call failed on "${serverName}/${toolName}": ${errorMessage}`);
      return {
        content: [
          {
            type: "text",
            text: `Error calling ${serverName}/${toolName}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Convert MCP tool result to our format
   */
  private convertResult(result: unknown): McpToolCallResult {
    if (!result || typeof result !== "object") {
      return {
        content: [{ type: "text", text: String(result) }],
      };
    }

    const r = result as Record<string, unknown>;

    // Handle standard MCP result format
    if (Array.isArray(r.content)) {
      const content = r.content.map((item: unknown) => {
        if (!item || typeof item !== "object") {
          return { type: "text" as const, text: String(item) };
        }
        const c = item as Record<string, unknown>;
        return {
          type: (c.type as "text" | "image" | "resource") ?? "text",
          text: c.text as string | undefined,
          data: c.data as string | undefined,
          mimeType: c.mimeType as string | undefined,
        };
      });

      return {
        content,
        isError: r.isError as boolean | undefined,
      };
    }

    // Fallback: convert to string
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  /**
   * Get all registered tool names
   */
  getRegisteredToolNames(): string[] {
    return Array.from(this.registeredTools.keys());
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.registeredTools.clear();
  }
}
