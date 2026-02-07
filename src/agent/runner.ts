import { buildClient } from "./llm.ts";
import { getSystemPrompt } from "./system-prompt.ts";
import { toolDefinitions, toolHandlers, setAppState, type AppState } from "../tools/index.ts";
import type { Message, ToolCallDescriptor, ServerMessage } from "../shared/types.ts";

export interface RunnerOptions {
  provider?: string;
  model?: string;
  maxSteps?: number;
  requestTimeoutMs?: number;
  broadcast: (message: ServerMessage) => void;
  getState: () => { pattern: string; playing: boolean; cps: number };
}

/**
 * Run the agent loop for a single user message
 */
export async function runAgent(userMessage: string, options: RunnerOptions): Promise<string> {
  const provider = options.provider ?? "openai";
  const model = options.model ?? "gpt-4o-mini";
  const maxSteps = options.maxSteps ?? 16;

  // Initialize app state for tools
  const appState: AppState = {
    currentPattern: options.getState().pattern,
    isPlaying: options.getState().playing,
    cps: options.getState().cps,
    evalErrors: [],
    broadcast: options.broadcast as (message: unknown) => void,
  };
  setAppState(appState);

  // Build LLM client
  const client = buildClient(provider, model);

  // Initialize conversation
  const messages: Message[] = [
    { role: "system", content: getSystemPrompt() },
    { role: "user", content: userMessage },
  ];

  // Broadcast that agent is thinking
  options.broadcast({ type: "agent_thinking", content: "Thinking..." });

  // Agent loop
  for (let step = 0; step < maxSteps; step++) {
    let response: { content: string | null; toolCalls?: ToolCallDescriptor[] } | undefined;
    try {
      response = await withTimeout(() => client.generate(messages, toolDefinitions), options.requestTimeoutMs);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const timeoutInfo = options.requestTimeoutMs ? ` after ${options.requestTimeoutMs}ms` : "";
      const displayMsg =
        errMsg === "Request timeout"
          ? `LLM request timed out${timeoutInfo}. Increase APFELSTRUDEL_TIMEOUT_MS if needed.`
          : errMsg;
      options.broadcast({ type: "error", message: `LLM error: ${displayMsg}` });
      return `Error: ${displayMsg}`;
    }

    // Handle tool calls
    if (response.toolCalls?.length) {
      // Add assistant message with tool calls
      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls,
      });

      // Execute each tool
      for (const call of response.toolCalls) {
        options.broadcast({
          type: "tool_start",
          name: call.name,
          args: call.arguments,
        });

        const handler = toolHandlers[call.name];
        if (!handler) {
          const errorMsg = `Unknown tool: ${call.name}`;
          messages.push({ role: "tool", content: errorMsg, tool_call_id: call.id });
          options.broadcast({ type: "tool_result", name: call.name, output: errorMsg, error: true });
          continue;
        }

        try {
          const result = await handler(call.arguments);
          messages.push({ role: "tool", content: result.output, tool_call_id: call.id });
          options.broadcast({
            type: "tool_result",
            name: call.name,
            output: result.output,
            error: result.error,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          messages.push({ role: "tool", content: `Error: ${errorMsg}`, tool_call_id: call.id });
          options.broadcast({ type: "tool_result", name: call.name, output: errorMsg, error: true });
        }
      }

      // Continue loop to get next response
      continue;
    }

    // No tool calls - this is the final response
    if (response.content) {
      options.broadcast({
        type: "agent_response",
        content: response.content,
      });
      return response.content;
    }
  }

  // Reached max steps
  const msg = "I've reached the maximum number of steps. Please try a simpler request.";
  options.broadcast({ type: "agent_response", content: msg });
  return msg;
}

/**
 * Utility to add timeout to a promise
 */
async function withTimeout<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return fn();

  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Request timeout")), timeoutMs)),
  ]);
}
