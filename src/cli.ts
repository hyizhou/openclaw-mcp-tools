/**
 * Standalone CLI entry point for testing
 *
 * Usage:
 *   MCP_SERVERS='[{"name":"test","type":"stdio","command":"node","args":["server.js"]}]' \
 *   npx tsx src/cli.ts mcp status
 *
 * Or with config file:
 *   MCP_CONFIG=./mcp-config.json npx tsx src/cli.ts mcp list
 */

import { Command } from "commander";
import { registerMcpCli, type McpCliOptions } from "./mcp-cli.js";
import { McpClientManager } from "./mcp-client.js";
import type { McpToolBridgeConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import fs from "node:fs/promises";

// Simple logger for CLI
const logger = {
  debug: (msg: string) => process.env.DEBUG && console.log(`[DEBUG] ${msg}`),
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

async function loadConfig(): Promise<McpToolBridgeConfig> {
  // Try env var first
  const envConfig = process.env.MCP_SERVERS;
  if (envConfig) {
    try {
      const parsed = JSON.parse(envConfig);
      return {
        servers: Array.isArray(parsed) ? parsed : parsed.servers ?? [],
        autoReconnect: parsed.autoReconnect ?? DEFAULT_CONFIG.autoReconnect,
        reconnectDelayMs: parsed.reconnectDelayMs ?? DEFAULT_CONFIG.reconnectDelayMs,
        toolCallTimeoutMs: parsed.toolCallTimeoutMs ?? DEFAULT_CONFIG.toolCallTimeoutMs,
      };
    } catch (e) {
      console.warn("Failed to parse MCP_SERVERS env:", e);
    }
  }

  // Try config file
  const configPath = process.env.MCP_CONFIG ?? "./mcp-config.json";
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    return {
      servers: parsed.servers ?? [],
      autoReconnect: parsed.autoReconnect ?? DEFAULT_CONFIG.autoReconnect,
      reconnectDelayMs: parsed.reconnectDelayMs ?? DEFAULT_CONFIG.reconnectDelayMs,
      toolCallTimeoutMs: parsed.toolCallTimeoutMs ?? DEFAULT_CONFIG.toolCallTimeoutMs,
    };
  } catch {
    // No config found, return empty
    return {
      servers: [],
      ...DEFAULT_CONFIG,
    };
  }
}

async function main() {
  const program = new Command();
  program
    .name("openclaw-mcp-tools")
    .description("MCP Tools CLI (standalone test mode)")
    .version("1.1.0");

  // Load config
  const config = await loadConfig();

  if (config.servers.length === 0) {
    console.log("No MCP servers configured.");
    console.log("");
    console.log("Set MCP_SERVERS env or create mcp-config.json:");
    console.log('  MCP_SERVERS=\'[{"name":"test","type":"stdio","command":"npx","args":["-y","@anthropic/mcp-server-test"]}]\' npx tsx src/cli.ts mcp status');
    console.log("");
    console.log("Or create mcp-config.json:");
    console.log('  {"servers":[{"name":"test","type":"stdio","command":"npx","args":["-y","@anthropic/mcp-server-test"]}]}');
  }

  // Create client manager
  const clientManager = new McpClientManager(logger, {
    autoReconnect: config.autoReconnect,
    reconnectDelayMs: config.reconnectDelayMs,
  });

  // Connect to servers before running commands
  const shouldConnect = process.argv[2] === "mcp" &&
    !["list", "help", "--help", "-h"].includes(process.argv[3] ?? "");

  if (shouldConnect && config.servers.length > 0) {
    const enabledServers = config.servers.filter((s) => s.enabled !== false);
    console.error(`Connecting to ${enabledServers.length} MCP server(s)...`);

    for (const serverConfig of enabledServers) {
      try {
        await clientManager.connect(serverConfig);
        console.error(`Connected to "${serverConfig.name}"`);
      } catch (e) {
        console.error(`Failed to connect to "${serverConfig.name}": ${e}`);
      }
    }
    console.error("");
  }

  // Register MCP CLI commands
  const cliOptions: McpCliOptions = {
    servers: config.servers,
    config,
    getClientManager: () => clientManager,
  };

  registerMcpCli(
    {
      program,
      config: {},
      workspaceDir: process.cwd(),
      logger,
    },
    cliOptions
  );

  // Parse arguments
  await program.parseAsync(process.argv);

  // Cleanup
  await clientManager.disconnectAll();
}

main().catch((e) => {
  console.error("CLI error:", e);
  process.exit(1);
});
