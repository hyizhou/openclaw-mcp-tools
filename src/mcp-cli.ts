/**
 * MCP CLI Commands - Manages MCP server connections via command line
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Command = any; // Commander type - provided by OpenClaw runtime
import { execFile } from "node:child_process";
import type { PluginLogger, McpServerConfig, McpToolBridgeConfig } from "./types.js";

// Re-export McpServerConfig for use in CLI
export type { McpServerConfig } from "./types.js";

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
  onConnect?: (serverName: string) => Promise<void>;
  onDisconnect?: (serverName: string) => Promise<void>;
  onReload?: (serverName: string) => Promise<void>;
  getClientManager: () => {
    getConnections: () => Map<string, { connected: boolean; tools: Array<{ originalName: string; registeredName: string }>; config: McpServerConfig; lastError?: Error }>;
    connect: (config: McpServerConfig) => Promise<unknown>;
    disconnect: (serverName: string) => Promise<void>;
    callTool: (serverName: string, toolName: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  } | null;
  config: McpToolBridgeConfig;
}

// ============================================================================
// Gateway Call Helper
// ============================================================================

/**
 * Call a Gateway method via `openclaw gateway call` CLI.
 * This connects to the main process's Gateway to get real MCP state.
 */
/**
 * Extract JSON from stdout that may contain plugin logs or other non-JSON lines.
 * The gateway JSON response is always the last complete JSON value in the output.
 */
function extractJsonFromOutput(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // stdout contains non-JSON lines (e.g. plugin logs).
    // Scan from the end to find the last '[' or '{' that starts valid JSON.
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

function callGatewayMethod(method: string, _params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = ["gateway", "call", method, "--timeout", "10000", "--json"];
    execFile("openclaw", args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      try {
        resolve(extractJsonFromOutput(stdout));
      } catch (e) {
        reject(new Error(`Invalid gateway response: ${stdout}`));
      }
    });
  });
}

/**
 * Check if Gateway is available (OpenClaw main process is running)
 */
function isGatewayAvailable(): boolean {
  // Gateway is available when running inside OpenClaw CLI
  // (the main process with MCP connections is running separately)
  return true;
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
    .description("Manage MCP server connections and tools");

  // mcp list - List configured MCP servers
  mcp
    .command("list")
    .description("List configured MCP servers")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      let result: ServerStatus[];

      if (isGatewayAvailable()) {
        try {
          result = await callGatewayMethod("mcp.list") as unknown as ServerStatus[];
        } catch (e) {
          console.error(`Gateway unavailable: ${(e as Error).message}`);
          console.log("(showing config-only info)");
          result = options.servers.map((server) => ({
            name: server.name,
            type: server.type,
            enabled: server.enabled !== false,
            connected: false,
            toolCount: 0,
          }));
        }
      } else {
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

      console.log("Configured MCP Servers:");
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
      const gwParams: Record<string, unknown> = {};
      if (opts.server) gwParams.server = opts.server;

      let tools: Array<{ name: string; server: string; originalName: string }>;

      if (isGatewayAvailable()) {
        try {
          tools = await callGatewayMethod("mcp.tools", gwParams) as unknown as typeof tools;
        } catch (e) {
          console.error(`Gateway unavailable: ${(e as Error).message}`);
          console.log("No MCP tools available.");
          return;
        }
      } else {
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

      console.log(`Available MCP Tools (${tools.length}):`);
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

  // mcp status - Show MCP connection status
  mcp
    .command("status")
    .description("Show MCP connection status and statistics")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      let result: {
        configured: number;
        enabled: number;
        connected: number;
        totalTools: number;
        servers: ServerStatus[];
      };

      if (isGatewayAvailable()) {
        try {
          result = await callGatewayMethod("mcp.status") as unknown as typeof result;
        } catch (e) {
          console.error(`Gateway unavailable: ${(e as Error).message}`);
          result = {
            configured: options.servers.length,
            enabled: options.servers.filter((s) => s.enabled !== false).length,
            connected: 0,
            totalTools: 0,
            servers: options.servers.map((server) => ({
              name: server.name,
              type: server.type,
              enabled: server.enabled !== false,
              connected: false,
              toolCount: 0,
            })),
          };
        }
      } else {
        result = {
          configured: options.servers.length,
          enabled: options.servers.filter((s) => s.enabled !== false).length,
          connected: 0,
          totalTools: 0,
          servers: options.servers.map((server) => ({
            name: server.name,
            type: server.type,
            enabled: server.enabled !== false,
            connected: false,
            toolCount: 0,
          })),
        };
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log("=== OpenClaw MCP Tools ===");
      console.log(`  configured: ${result.configured}, connected: ${result.connected}, tools: ${result.totalTools}`);
      console.log("");

      if (result.connected > 0) {
        const connectedServers = result.servers.filter((s) => s.connected);
        for (const server of connectedServers) {
          console.log(`  [\x1b[36m${server.name}\x1b[0m] (${server.toolCount} tools)`);
        }
      }

      const pendingServers = result.servers.filter((s) => s.enabled && !s.connected);
      if (pendingServers.length > 0) {
        const pending = pendingServers.map((s) => s.name).join(", ");
        console.log(`  pending: ${pending}`);
      }

      console.log("=========================");
    });

  // mcp call - Call an MCP tool
  mcp
    .command("call <server> <tool>")
    .description("Call an MCP tool with JSON arguments")
    .argument("[args]", "JSON arguments (default: {})")
    .option("--timeout <ms>", "Timeout in milliseconds", (val: string) => parseInt(val, 10), 60000)
    .action(async (server: string, tool: string, argsJson: string | undefined, opts: { timeout: number }) => {
      const clientManager = options.getClientManager();
      if (!clientManager) {
        console.error("MCP client manager not initialized");
        process.exitCode = 1;
        return;
      }

      let args: Record<string, unknown> = {};
      if (argsJson) {
        try {
          args = JSON.parse(argsJson);
        } catch (e) {
          console.error(`Invalid JSON arguments: ${e}`);
          process.exitCode = 1;
          return;
        }
      }

      try {
        console.log(`Calling ${server}/${tool}...`);
        const result = await clientManager.callTool(server, tool, args, opts.timeout);
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`Tool call failed: ${message}`);
        process.exitCode = 1;
      }
    });

  // mcp connect - Connect to an MCP server
  mcp
    .command("connect <server>")
    .description("Connect to a configured MCP server")
    .action(async (serverName: string) => {
      const serverConfig = options.servers.find((s) => s.name === serverName);
      if (!serverConfig) {
        console.error(`Server "${serverName}" not found in configuration`);
        process.exitCode = 1;
        return;
      }

      const clientManager = options.getClientManager();
      if (!clientManager) {
        console.error("MCP client manager not initialized");
        process.exitCode = 1;
        return;
      }

      const connections = clientManager.getConnections();
      const existing = connections.get(serverName);
      if (existing?.connected) {
        console.log(`Server "${serverName}" is already connected`);
        return;
      }

      try {
        console.log(`Connecting to "${serverName}"...`);
        await clientManager.connect(serverConfig);
        console.log(`\x1b[32mConnected to "${serverName}"\x1b[0m`);

        if (options.onConnect) {
          await options.onConnect(serverName);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`Failed to connect to "${serverName}": ${message}`);
        process.exitCode = 1;
      }
    });

  // mcp disconnect - Disconnect from an MCP server
  mcp
    .command("disconnect <server>")
    .description("Disconnect from an MCP server")
    .action(async (serverName: string) => {
      const clientManager = options.getClientManager();
      if (!clientManager) {
        console.error("MCP client manager not initialized");
        process.exitCode = 1;
        return;
      }

      const connections = clientManager.getConnections();
      const existing = connections.get(serverName);
      if (!existing?.connected) {
        console.log(`Server "${serverName}" is not connected`);
        return;
      }

      try {
        console.log(`Disconnecting from "${serverName}"...`);
        await clientManager.disconnect(serverName);
        console.log(`\x1b[32mDisconnected from "${serverName}"\x1b[0m`);

        if (options.onDisconnect) {
          await options.onDisconnect(serverName);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`Failed to disconnect from "${serverName}": ${message}`);
        process.exitCode = 1;
      }
    });

  // mcp reload - Reload MCP server connections
  mcp
    .command("reload [server]")
    .description("Reload MCP server connections (disconnect and reconnect)")
    .action(async (serverName?: string) => {
      const clientManager = options.getClientManager();
      if (!clientManager) {
        console.error("MCP client manager not initialized");
        process.exitCode = 1;
        return;
      }

      const serversToReload = serverName
        ? options.servers.filter((s) => s.name === serverName)
        : options.servers.filter((s) => s.enabled !== false);

      if (serversToReload.length === 0) {
        if (serverName) {
          console.error(`Server "${serverName}" not found in configuration`);
        } else {
          console.log("No servers to reload");
        }
        process.exitCode = serverName ? 1 : 0;
        return;
      }

      for (const serverConfig of serversToReload) {
        const name = serverConfig.name;
        try {
          // Disconnect if connected
          const connections = clientManager.getConnections();
          if (connections.get(name)?.connected) {
            console.log(`Disconnecting from "${name}"...`);
            await clientManager.disconnect(name);
          }

          // Reconnect
          console.log(`Connecting to "${name}"...`);
          await clientManager.connect(serverConfig);
          console.log(`\x1b[32mReloaded "${name}"\x1b[0m`);

          if (options.onReload) {
            await options.onReload(name);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error(`Failed to reload "${name}": ${message}`);
        }
      }
    });
}
