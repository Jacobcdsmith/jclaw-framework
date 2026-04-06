export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
}

export interface McpToolDef {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCall {
  serverId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface McpToolResult {
  serverId: string;
  tool: string;
  result: unknown;
  isError: boolean;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
