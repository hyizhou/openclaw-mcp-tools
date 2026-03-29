/**
 * OpenClaw Plugin SDK Type Declarations
 *
 * These types are provided by OpenClaw at runtime.
 * This file is for development-time type checking when building standalone.
 */

// ============================================================================
// Plugin Entry Module
// ============================================================================

declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { Static, TSchema } from "@sinclair/typebox";

  // ============================================================================
  // Common Types
  // ============================================================================

  export interface PluginLogger {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  }

  export interface OpenClawToolInputSchema {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
  }

  export interface OpenClawToolDefinition {
    name: string;
    label?: string;
    description: string;
    parameters: OpenClawToolInputSchema | Record<string, unknown>;
    execute: (
      toolCallId: string,
      args: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown
    ) => Promise<OpenClawToolResult>;
  }

  export interface OpenClawToolContext {
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

  export interface OpenClawToolResult {
    content: Array<{
      type: "text" | "image" | "resource";
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    isError?: boolean;
    details?: Record<string, unknown>;
  }

  export interface OpenClawServiceContext {
    config: unknown;
    stateDir: string;
    logger: PluginLogger;
  }

  export interface OpenClawServiceDefinition {
    id: string;
    start: (ctx: OpenClawServiceContext) => void | Promise<void>;
    stop?: (ctx: OpenClawServiceContext) => void | Promise<void>;
  }

  export type PluginHookName =
    | "before_model_resolve"
    | "before_prompt_build"
    | "before_agent_start"
    | "llm_input"
    | "llm_output"
    | "agent_end"
    | "before_compaction"
    | "after_compaction"
    | "before_reset"
    | "message_received"
    | "message_sending"
    | "message_sent"
    | "before_tool_call"
    | "after_tool_call"
    | "tool_result_persist"
    | "before_message_write"
    | "session_start"
    | "session_end"
    | "subagent_spawning"
    | "subagent_delivery_target"
    | "subagent_spawned"
    | "subagent_ended"
    | "gateway_start"
    | "gateway_stop";

  export interface PluginHookContext {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    workspaceDir?: string;
    messageProvider?: string;
    trigger?: "user" | "heartbeat" | "cron" | "memory";
    channelId?: string;
  }

  // ============================================================================
  // Plugin API
  // ============================================================================

  export interface OpenClawPluginApi {
    // Plugin metadata
    id: string;
    name: string;
    version?: string;
    description?: string;
    source: string;
    rootDir?: string;

    // Configuration
    config: unknown;
    pluginConfig?: Record<string, unknown>;

    // Runtime
    logger: PluginLogger;
    resolvePath: (input: string) => string;
    registrationMode?: "full" | "setup-only" | "setup-runtime";

    // Tool registration
    registerTool: (
      tool:
        | OpenClawToolDefinition
        | ((context: OpenClawToolContext) => OpenClawToolDefinition[] | undefined),
      options?: { optional?: boolean }
    ) => void;

    // Service registration
    registerService: (service: OpenClawServiceDefinition) => void;

    // Hook registration
    on: <K extends PluginHookName>(
      hookName: K,
      handler: (event: unknown, context: PluginHookContext) => Promise<unknown> | unknown,
      options?: { priority?: number }
    ) => void;
    registerHook: (
      hookNames: PluginHookName | PluginHookName[],
      handler: (event: unknown, context: PluginHookContext) => Promise<unknown> | unknown,
      options?: { name?: string }
    ) => void;

    // Other registration methods
    registerHttpRoute: (route: unknown) => void;
    registerChannel: (channel: unknown) => void;
    registerGatewayMethod: (name: string, handler: unknown) => void;
    registerCli: (
      registrar: (ctx: {
        program: import("commander").Command;
        config: unknown;
        workspaceDir?: string;
        logger: PluginLogger;
      }) => void | Promise<void>,
      opts?: { commands?: string[] }
    ) => void;
    registerProvider: (provider: unknown) => void;
    registerCommand: (command: unknown) => void;
    registerContextEngine: (name: string, factory: unknown) => void;
  }

  // ============================================================================
  // Plugin Entry Types (for definePluginEntry)
  // ============================================================================

  export interface OpenClawPluginConfigSchema extends TSchema {
    type: "object";
    properties?: Record<string, TSchema>;
    required?: string[];
    additionalProperties?: boolean | TSchema;
  }

  export interface OpenClawPluginEntry<
    TConfig extends OpenClawPluginConfigSchema = OpenClawPluginConfigSchema
  > {
    id: string;
    name: string;
    description?: string;
    version?: string;
    kind?: "memory" | "context-engine";
    configSchema?: TConfig | (() => TConfig);
    register: (api: OpenClawPluginApi) => void | Promise<void>;
  }

  /**
   * Define a plugin entry point (new SDK style)
   */
  export function definePluginEntry<
    TConfig extends OpenClawPluginConfigSchema = OpenClawPluginConfigSchema
  >(entry: OpenClawPluginEntry<TConfig>): OpenClawPluginEntry<TConfig>;
}

// ============================================================================
// Legacy Module (deprecated but kept for backwards compatibility)
// ============================================================================

declare module "openclaw/plugin-sdk" {
  export * from "openclaw/plugin-sdk/plugin-entry";
}
