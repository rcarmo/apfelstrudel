import type { ServerWebSocket } from "bun";
import { runAgent } from "../agent/index.ts";
import type { ClientMessage, ServerMessage } from "../shared/types.ts";
import { pushEvalError } from "../tools/shared.ts";

export interface WebSocketData {
  id: string;
}

// Connected clients
const clients = new Map<string, ServerWebSocket<WebSocketData>>();

// Shared state
let currentPattern = `// Welcome to Apfelstrudel! 🥧
// A live-coding music environment powered by Strudel
// Press Play or ask the AI to get started!

stack(
  // drums
  s("bd [~ bd] sd [bd ~ ]")
    .bank("RolandTR808"),

  s("[~ hh]*4")
    .gain(.6)
    .bank("RolandTR808"),

  // bass
  note("<c2 [c2 eb2] f2 [f2 ab2]>")
    .s("sawtooth")
    .lpf(600)
    .decay(.15)
    .sustain(0),

  // melody
  note("<[c4 eb4 g4] [f4 ab4 c5] [eb4 g4 bb4] [ab4 c5 eb5]>/2")
    .s("triangle")
    .gain(.35)
    .delay(.25)
    .room(.3)
)`;
let isPlaying = false;
let cps = 0.5;

/**
 * Broadcast a message to all connected clients
 */
export function broadcast(message: ServerMessage): void {
  const json = JSON.stringify(message);
  for (const client of clients.values()) {
    client.send(json);
  }
}

/**
 * Get current app state
 */
export function getState() {
  return { pattern: currentPattern, playing: isPlaying, cps };
}

/**
 * WebSocket handlers for Bun.serve
 */
export const websocketHandlers = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const id = crypto.randomUUID();
    ws.data = { id };
    clients.set(id, ws);
    console.log(`[WS] Client connected: ${id}`);

    // Send current state to new client
    const syncMessage: ServerMessage = {
      type: "sync_state",
      pattern: currentPattern,
      playing: isPlaying,
      cps,
    };
    ws.send(JSON.stringify(syncMessage));
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    const id = ws.data.id;
    clients.delete(id);
    console.log(`[WS] Client disconnected: ${id}`);
  },

  async message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    try {
      const data = JSON.parse(message.toString()) as ClientMessage;
      console.log("[WS] Received:", data.type);

      switch (data.type) {
        case "chat":
          await handleChat(data.message);
          break;

        case "client_log": {
          const level = data.level ?? "info";
          const prefix = `[WS][client ${ws.data.id}]`;
          if (level === "error") {
            console.error(prefix, data.message, data.stack ?? "");
            pushEvalError(data.message);
          } else if (level === "warn") {
            console.warn(prefix, data.message);
          } else {
            console.log(prefix, data.message);
          }
          break;
        }

        case "pattern_update":
          currentPattern = data.code;
          // Broadcast to other clients
          broadcast({ type: "set_pattern", code: data.code });
          break;

        case "transport":
          isPlaying = data.action === "play";
          broadcast({ type: "transport_control", action: data.action });
          break;

        case "sync_request":
          ws.send(
            JSON.stringify({
              type: "sync_state",
              pattern: currentPattern,
              playing: isPlaying,
              cps,
            } satisfies ServerMessage)
          );
          break;

        default:
          console.log("[WS] Unknown message type:", data);
      }
    } catch (err) {
      console.error("[WS] Error processing message:", err);
      ws.send(
        JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        } satisfies ServerMessage)
      );
    }
  },
};

/**
 * Handle incoming chat message from user
 */
async function handleChat(userMessage: string): Promise<void> {
  const provider = process.env.APFELSTRUDEL_PROVIDER
    ?? (process.env.AZURE_OPENAI_API_KEY ? "azure" : "openai");
  const model = process.env.APFELSTRUDEL_MODEL ?? "gpt-4o-mini";
  const maxSteps = Number.parseInt(process.env.APFELSTRUDEL_MAX_STEPS ?? "16", 10);
  const timeoutMs = Number.parseInt(process.env.APFELSTRUDEL_TIMEOUT_MS ?? "120000", 10);

  try {
    await runAgent(userMessage, {
      provider,
      model,
      maxSteps,
      requestTimeoutMs: timeoutMs,
      broadcast,
      getState,
    });
  } catch (err) {
    console.error("[Agent] Error:", err);
    broadcast({
      type: "error",
      message: err instanceof Error ? err.message : "Agent error",
    });
  }
}

/**
 * Update pattern from tool
 */
export function setPattern(code: string): void {
  currentPattern = code;
}

/**
 * Update transport state from tool
 */
export function setPlaying(playing: boolean): void {
  isPlaying = playing;
}

/**
 * Update tempo from tool
 */
export function setCps(newCps: number): void {
  cps = newCps;
}
