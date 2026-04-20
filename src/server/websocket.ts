import type { ServerWebSocket } from "bun";
import { runAgent } from "../agent/index.ts";
import type { ClientMessage, ServerMessage, SessionState, Tab } from "../shared/types.ts";
import { pushEvalError } from "../tools/shared.ts";
import { loadSession, saveSession } from "./session.ts";

export interface WebSocketData {
  id: string;
}

// Connected clients
const clients = new Map<string, ServerWebSocket<WebSocketData>>();

// Shared state
let sessionState: SessionState = await loadSession();
let isPlaying = false;
let cps = 0.5;

// Debounced save
let saveTimeout: Timer | null = null;
function triggerSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveSession(sessionState);
    saveTimeout = null;
  }, 1000);
}

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
 * Get current app state (for agent tools)
 */
export function getState() {
  const activeTab = sessionState.tabs.find(t => t.id === sessionState.activeTabId);
  return {
    pattern: activeTab?.content || "",
    playing: isPlaying,
    cps
  };
}

/**
 * Update server state. Called by tools via AppState setters.
 */
export function updateState(updates: { pattern?: string; playing?: boolean; cps?: number }) {
  if (updates.pattern !== undefined) {
    const activeTab = sessionState.tabs.find(t => t.id === sessionState.activeTabId);
    if (activeTab) {
      activeTab.content = updates.pattern;
      triggerSave();
      broadcast({ type: "session_update", session: sessionState });
    }
  }
  if (updates.playing !== undefined) isPlaying = updates.playing;
  if (updates.cps !== undefined) cps = updates.cps;
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
    const activeTab = sessionState.tabs.find(t => t.id === sessionState.activeTabId);
    
    ws.send(JSON.stringify({
      type: "session_update",
      session: sessionState
    } satisfies ServerMessage));
    
    ws.send(JSON.stringify({
      type: "sync_state",
      pattern: activeTab?.content || "",
      playing: isPlaying,
      cps,
    } satisfies ServerMessage));
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    const id = ws.data.id;
    clients.delete(id);
    console.log(`[WS] Client disconnected: ${id}`);
  },

  async message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    try {
      const data = JSON.parse(message.toString()) as ClientMessage;
      // console.log("[WS] Received:", data.type);

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

        case "pattern_update": {
          const activeTab = sessionState.tabs.find(t => t.id === sessionState.activeTabId);
          if (activeTab) {
            activeTab.content = data.code;
            triggerSave();
            // Optional: broadcast session update if needed, but usually only done on tab switch/create
            // to avoid spamming. However, strictly speaking, all clients should see live edits.
            // Let's broadcast to keep clients in sync.
            broadcast({ type: "session_update", session: sessionState });
          }
          break;
        }

        case "create_tab": {
          const newTab: Tab = {
            id: crypto.randomUUID(),
            title: `Tab ${sessionState.tabs.length + 1}`,
            content: "// New Pattern\n"
          };
          sessionState.tabs.push(newTab);
          sessionState.activeTabId = newTab.id;
          triggerSave();
          broadcast({ type: "session_update", session: sessionState });
          break;
        }

        case "close_tab": {
          if (sessionState.tabs.length <= 1) return; // Prevent closing last tab
          sessionState.tabs = sessionState.tabs.filter(t => t.id !== data.id);
          if (sessionState.activeTabId === data.id) {
            sessionState.activeTabId = sessionState.tabs[0].id;
          }
          triggerSave();
          broadcast({ type: "session_update", session: sessionState });
          break;
        }

        case "switch_tab": {
          const target = sessionState.tabs.find(t => t.id === data.id);
          if (target) {
            sessionState.activeTabId = data.id;
            triggerSave();
            broadcast({ type: "session_update", session: sessionState });
          }
          break;
        }

        case "rename_tab": {
          const tab = sessionState.tabs.find(t => t.id === data.id);
          if (tab && data.title) {
            tab.title = data.title;
            triggerSave();
            broadcast({ type: "session_update", session: sessionState });
          }
          break;
        }

        case "update_tab": {
           const tab = sessionState.tabs.find(t => t.id === data.id);
           if (tab) {
             tab.content = data.content;
             triggerSave();
             broadcast({ type: "session_update", session: sessionState });
           }
           break;
        }

        case "transport":
          isPlaying = data.action === "play";
          broadcast({ type: "transport_control", action: data.action });
          break;

        case "sync_request": {
          const activeTab = sessionState.tabs.find(t => t.id === sessionState.activeTabId);
          ws.send(
            JSON.stringify({
              type: "sync_state",
              pattern: activeTab?.content || "",
              playing: isPlaying,
              cps,
            } satisfies ServerMessage)
          );
          ws.send(JSON.stringify({ type: "session_update", session: sessionState }));
          break;
        }

        default:
          console.log("[WS] Unknown message type:", (data as any).type);
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
      updateState,
    });
  } catch (err) {
    console.error("[Agent] Error:", err);
    broadcast({
      type: "error",
      message: err instanceof Error ? err.message : "Agent error",
    });
  }
}
