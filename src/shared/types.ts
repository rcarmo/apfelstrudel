// Shared types between server and client

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCallDescriptor {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: Role;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCallDescriptor[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  output: string;
  error?: boolean;
}

export interface LLMClient {
  generate(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }>;
}

// WebSocket message types

export interface ClientChatMessage {
  type: "chat";
  message: string;
}

export interface ClientPatternUpdate {
  type: "pattern_update";
  code: string;
}

export interface ClientTransport {
  type: "transport";
  action: "play" | "stop";
}

export interface ClientSyncRequest {
  type: "sync_request";
}

export interface ClientLog {
  type: "client_log";
  level: "error" | "warn" | "info";
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface ServerAgentThinking {
  type: "agent_thinking";
  content: string;
}

export interface ServerAgentResponse {
  type: "agent_response";
  content: string;
  toolCalls?: ToolCallDescriptor[];
}

export interface ServerToolStart {
  type: "tool_start";
  name: string;
  args: Record<string, unknown>;
}

export interface ServerToolResult {
  type: "tool_result";
  name: string;
  output: string;
  error?: boolean;
}

export interface ServerSetPattern {
  type: "set_pattern";
  code: string;
  autoplay?: boolean;
}

export interface ServerTransportControl {
  type: "transport_control";
  action: "play" | "stop";
}

export interface ServerSetCps {
  type: "set_cps";
  cps: number;
}

export interface ServerSyncState {
  type: "sync_state";
  pattern: string;
  playing: boolean;
  cps: number;
}

export interface ServerError {
  type: "error";
  message: string;
}

export interface Tab {
  id: string;
  title: string;
  content: string;
}

export interface SessionState {
  tabs: Tab[];
  activeTabId: string;
}

export interface ClientCreateTab {
  type: "create_tab";
}

export interface ClientCloseTab {
  type: "close_tab";
  id: string;
}

export interface ClientSwitchTab {
  type: "switch_tab";
  id: string;
}

export interface ClientUpdateTab {
  type: "update_tab";
  id: string;
  content: string;
}

export interface ClientRenameTab {
  type: "rename_tab";
  id: string;
  title: string;
}

export interface ServerSessionUpdate {
  type: "session_update";
  session: SessionState;
}

export type ClientMessage =
  | ClientChatMessage
  | ClientPatternUpdate
  | ClientTransport
  | ClientSyncRequest
  | ClientLog
  | ClientCreateTab
  | ClientCloseTab
  | ClientSwitchTab
  | ClientUpdateTab
  | ClientRenameTab;

export type ServerMessage =
  | ServerAgentThinking
  | ServerAgentResponse
  | ServerToolStart
  | ServerToolResult
  | ServerSetPattern
  | ServerTransportControl
  | ServerSetCps
  | ServerSyncState
  | ServerError
  | ServerSessionUpdate;

