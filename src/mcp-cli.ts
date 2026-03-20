/**
 * MCP CLI Commands - View MCP server status and tools
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Command = any; // Commander type - provided by OpenClaw runtime
import { execFile } from "node:child_process";
import type { PluginLogger, McpServerConfig } from "./types.js";

/**
 * CLI context passed to registerMcpCli
 */
export interface McpCliContext {
  program: Command;
  config: unknown;
  workspaceDir?: string;
  logger: PluginLogger;
}

/**
 * MCP CLI options
 */
export interface McpCliOptions {
  servers: McpServerConfig[];
  /** Optional: for standalone CLI without Gateway */
  getClientManager?: () => {
    getConnections: () => Map<string, { connected: boolean; tools: Array<{ originalName: string; registeredName: string }>; config: McpServerConfig }>;
  } | null;
}

// ============================================================================
// Gateway Call Helper
// ============================================================================

/**
 * Extract JSON from stdout that may contain plugin logs or other non-JSON lines.
 */
function extractJsonFromOutput(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // stdout contains non-JSON lines (e.g. plugin logs).
  }
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i] === "[" || trimmed[i] === "{") {
      try {
        return JSON.parse(trimmed.slice(i));
      } catch {
        // Not the start of the JSON response, try earlier
      }
    }
  }
  throw new Error(`No valid JSON found in gateway output`);
}

function callGatewayMethod(method: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = ["gateway", "call", method, "--timeout", "10000", "--json"];
    execFile("openclaw", args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      try {
        resolve(extractJsonFromOutput(stdout));
      } catch {
        reject(new Error(`Invalid gateway response: ${stdout}`));
      }
    });
  });
}

// ============================================================================
// Formatting Helpers
// ============================================================================

interface ServerStatus {
  name: string;
  type: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  error?: string;
}

function formatServerStatus(server: ServerStatus): void {
  const status = server.connected ? "\x1b[32mconnected\x1b[0m" :
                 server.enabled ? "\x1b[33mdisconnected\x1b[0m" :
                 "\x1b[90mdisabled\x1b[0m";
  const toolInfo = server.connected ? ` (${server.toolCount} tools)` : "";
  const errorInfo = server.error ? ` \x1b[31merror: ${server.error}\x1b[0m` : "";
  console.log(`  ${server.name}`);
  console.log(`    type: ${server.type}`);
  console.log(`    status: ${status}${toolInfo}${errorInfo}`);
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register MCP CLI commands
 */
export function registerMcpCli(ctx: McpCliContext, options: McpCliOptions): void {
  const mcp = ctx.program
    .command("mcp")
    .description("View MCP server connections and tools");

  // mcp list - List configured MCP servers
  mcp
    .command("list")
    .description("List configured MCP servers and their connection status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      let result: ServerStatus[];

      try {
        result = await callGatewayMethod("mcp.list") as unknown as ServerStatus[];
      } catch (e) {
        console.error(`Gateway unavailable: ${(e as Error).message}`);
        result = options.servers.map((server) => ({
          name: server.name,
          type: server.type,
          enabled: server.enabled !== false,
          connected: false,
          toolCount: 0,
        }));
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.length === 0) {
        console.log("No MCP servers configured.");
        return;
      }

      console.log("MCP Servers:");
      console.log("");
      for (const server of result) {
        formatServerStatus(server);
      }
    });

  // mcp tools - List available MCP tools
  mcp
    .command("tools")
    .description("List available MCP tools from connected servers")
    .option("--server <name>", "Filter by server name")
    .option("--json", "Output as JSON")
    .action(async (opts: { server?: string; json?: boolean }) => {
      let tools: Array<{ name: string; server: string; originalName: string }>;

      try {
        const params = opts.server ? `{"server":"${opts.server}"}` : "{}";
        tools = await callGatewayMethod(`mcp.tools?params=${encodeURIComponent(params)}`) as unknown as typeof tools;
      } catch (e) {
        console.error(`Gateway unavailable: ${(e as Error).message}`);
        tools = [];
      }

      if (opts.json) {
        console.log(JSON.stringify(tools, null, 2));
        return;
      }

      if (tools.length === 0) {
        console.log("No MCP tools available.");
        return;
      }

      console.log(`MCP Tools (${tools.length}):`);
      console.log("");

      // Group by server
      const byServer = new Map<string, typeof tools>();
      for (const tool of tools) {
        const list = byServer.get(tool.server) ?? [];
        list.push(tool);
        byServer.set(tool.server, list);
      }

      for (const [serverName, serverTools] of byServer) {
        console.log(`  [\x1b[36m${serverName}\x1b[0m] (${serverTools.length} tools)`);
        for (const tool of serverTools) {
          const nameDisplay = tool.name !== tool.originalName
            ? `${tool.name} (${tool.originalName})`
            : tool.name;
          console.log(`    - ${nameDisplay}`);
        }
      }
    });
}
