/**
 * MCP CLI Commands - Manages MCP server connections via command line
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Command = any; // Commander type - provided by OpenClaw runtime
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
      const servers = options.servers;
      const clientManager = options.getClientManager();
      const connections = clientManager?.getConnections() ?? new Map();

      const result = servers.map((server) => {
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
        const status = server.connected ? "\x1b[32mconnected\x1b[0m" :
                       server.enabled ? "\x1b[33mdisconnected\x1b[0m" :
                       "\x1b[90mdisabled\x1b[0m";
        const toolInfo = server.connected ? ` (${server.toolCount} tools)` : "";
        const errorInfo = server.error ? ` \x1b[31merror: ${server.error}\x1b[0m` : "";
        console.log(`  ${server.name}`);
        console.log(`    type: ${server.type}`);
        console.log(`    status: ${status}${toolInfo}${errorInfo}`);
      }
    });

  // mcp tools - List available MCP tools
  mcp
    .command("tools")
    .description("List available MCP tools from connected servers")
    .option("--server <name>", "Filter by server name")
    .option("--json", "Output as JSON")
    .action(async (opts: { server?: string; json?: boolean }) => {
      const clientManager = options.getClientManager();
      const connections = clientManager?.getConnections() ?? new Map();

      const tools: Array<{
        name: string;
        server: string;
        originalName: string;
      }> = [];

      for (const [serverName, conn] of connections) {
        if (!conn.connected) continue;
        if (opts.server && serverName !== opts.server) continue;

        for (const tool of conn.tools) {
          tools.push({
            name: tool.registeredName,
            server: serverName,
            originalName: tool.originalName,
          });
        }
      }

      // Suppress unused variable warning
      void tools;

      if (opts.json) {
        console.log(JSON.stringify(tools, null, 2));
        return;
      }

      if (tools.length === 0) {
        console.log("No MCP tools available.");
        if (connections.size === 0) {
          console.log("Hint: No servers are connected.");
        }
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
      const servers = options.servers;
      const clientManager = options.getClientManager();
      const connections = clientManager?.getConnections() ?? new Map();

      const enabledServers = servers.filter((s) => s.enabled !== false);
      const connectedServers = Array.from(connections.values()).filter((c) => c.connected);
      const totalTools = connectedServers.reduce((sum, c) => sum + c.tools.length, 0);

      const result = {
        configured: servers.length,
        enabled: enabledServers.length,
        connected: connectedServers.length,
        totalTools,
        servers: servers.map((server) => {
          const conn = connections.get(server.name);
          return {
            name: server.name,
            type: server.type,
            enabled: server.enabled !== false,
            connected: conn?.connected ?? false,
            toolCount: conn?.tools?.length ?? 0,
            error: conn?.lastError?.message,
          };
        }),
      };

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log("=== OpenClaw MCP Tools ===");
      console.log(`  configured: ${result.configured}, connected: ${result.connected}, tools: ${totalTools}`);
      console.log("");

      if (connectedServers.length > 0) {
        for (const [serverName, conn] of connections) {
          if (!conn.connected) continue;
          const toolNames = conn.tools.map((t: { registeredName: string }) => t.registeredName).join(", ");
          console.log(`  [\x1b[36m${serverName}\x1b[0m] (${conn.tools.length}) ${toolNames}`);
        }
      }

      const pendingServers = enabledServers.filter((s) => !connections.get(s.name)?.connected);
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
