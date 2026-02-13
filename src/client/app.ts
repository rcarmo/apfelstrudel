/**
 * Apfelstrudel Frontend Application
 * WebSocket client + Strudel.cc integration
 *
 * NOTE: All dependencies are vendored in /vendor/
 * No CDN imports allowed - see .github/copilot-instructions.md
 *
 * This file is bundled to public/app.js via `make build-client`
 */

import { initStrudel, controls, hush, evalScope, transpiler, samples, webaudioOutput } from "@strudel/web";
import { getAudioContext, setAudioContext, initAudio } from "@strudel/webaudio";

// Dynamic import to prevent the entire app from failing if codemirror can't load.
// The specifier is constructed via a variable to prevent Bun from hoisting it to a static import.
// biome-ignore lint/suspicious/noExplicitAny: dynamically imported module
let StrudelMirrorCtor: any = null;
const _cmSpec = "@strudel/codemirror";
const codemirrorReady = import(/* @vite-ignore */ _cmSpec)
  .then((mod) => {
    StrudelMirrorCtor = mod.StrudelMirror;
    console.log("[Editor] @strudel/codemirror loaded");
  })
  .catch((err) => {
    console.error("[Editor] Failed to load @strudel/codemirror:", err);
  });

// Types
interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

// biome-ignore lint/suspicious/noExplicitAny: CodeMirror EditorView type from vendored module
type EditorView = any;

// DOM Elements
const editorRoot = document.getElementById("code-editor") as HTMLDivElement;
const chatMessages = document.getElementById("chat-messages") as HTMLDivElement;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const btnPlay = document.getElementById("btn-play") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const tempoInput = document.getElementById("tempo") as HTMLInputElement;
const statusIndicator = document.getElementById("status-indicator") as HTMLSpanElement;
const resizeHandle = document.getElementById("resize-handle") as HTMLDivElement;
const editorPane = document.querySelector(".editor-pane") as HTMLElement;
const vizContainer = document.getElementById("visualization") as HTMLDivElement;

// Set up pianoroll canvas
const vizCanvas = document.createElement("canvas");
vizCanvas.id = "pianoroll-canvas";
vizContainer.appendChild(vizCanvas);
function resizeVizCanvas(): void {
  const r = window.devicePixelRatio || 1;
  vizCanvas.width = vizContainer.clientWidth * r;
  vizCanvas.height = vizContainer.clientHeight * r;
}
resizeVizCanvas();
window.addEventListener("resize", resizeVizCanvas);
const drawCtx = vizCanvas.getContext("2d") as CanvasRenderingContext2D;

function getAudioTime(): number {
  return getAudioContext().currentTime;
}

let samplesLoaded = false;
async function ensureSamplesLoaded(): Promise<void> {
  if (samplesLoaded) return;
  try {
    await samples("/vendor/strudel/samples/strudel.json");
    console.log("[Samples] Loaded local samples");
  } catch (err) {
    console.error("[Samples] Failed to load local samples:", err);
  }
  try {
    await samples("/vendor/strudel/samples/dirt-samples.json");
    console.log("[Samples] Loaded Dirt-Samples manifest");
  } catch (err) {
    console.error("[Samples] Failed to load Dirt-Samples:", err);
  }
  samplesLoaded = true;
}

// State
let ws: WebSocket | null = null;
let isPlaying = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// Strudel + CodeMirror instances
let strudelRepl: Awaited<ReturnType<typeof initStrudel>> | null = null;
let strudelInitPromise: Promise<void> | null = null;
let editorView: EditorView | null = null;
// biome-ignore lint/suspicious/noExplicitAny: StrudelMirror type from vendored module
let strudelMirror: any | null = null;

/** Get the current code from the CodeMirror editor (or fallback textarea) */
function getEditorCode(): string {
  if (editorView?.state?.doc) return editorView.state.doc.toString();
  const fb = document.getElementById("code-editor-fallback") as HTMLTextAreaElement | null;
  return fb?.value ?? "";
}

/** Set the code in the CodeMirror editor (or fallback textarea) */
function setEditorCode(code: string): void {
  if (editorView) {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: code },
    });
    return;
  }
  const fb = document.getElementById("code-editor-fallback") as HTMLTextAreaElement | null;
  if (fb) fb.value = code;
}

/**
 * Initialize Strudel REPL (fallback only — used when StrudelMirror is not available).
 * Must be called after a user gesture so the AudioContext can be created.
 */
async function initializeStrudel(): Promise<void> {
  if (strudelRepl) return;
  if (strudelMirror) return; // StrudelMirror has its own repl
  if (strudelInitPromise) return strudelInitPromise;
  strudelInitPromise = (async () => {
    try {
      strudelRepl = await initStrudel({
        editPattern: (pat: unknown) =>
          (pat as { pianoroll: (opts: Record<string, unknown>) => unknown }).pianoroll({ ctx: drawCtx, cycles: 8, playhead: 0.5 }),
        prebake: async () => {
          const miniModule = await import("@strudel/mini");
          const webaudioModule = await import("@strudel/webaudio");
          const drawModule = await import("@strudel/draw");
          await evalScope(miniModule, webaudioModule, drawModule);
        },
      });
      console.log("[Strudel] Initialized (fallback REPL)");
      updateStatus("Ready");
    } catch (err) {
      console.error("[Strudel] Init error:", err);
      updateStatus("Error", "error");
      strudelInitPromise = null;
    }
  })();
  return strudelInitPromise;
}

/** Ensure strudel is initialized, triggering init on first user gesture. */
async function ensureStrudel(): Promise<void> {
  if (strudelMirror) return; // StrudelMirror handles its own lifecycle
  if (!strudelRepl) await initializeStrudel();
}

/**
 * Connect to WebSocket server
 */
function connectWebSocket(): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = (): void => {
    console.log("[WS] Connected");
    reconnectAttempts = 0;
    updateStatus("Connected");
  };

  ws.onclose = (): void => {
    console.log("[WS] Disconnected");
    updateStatus("Disconnected", "error");
    ws = null;

    // Attempt reconnection
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
      setTimeout(connectWebSocket, delay);
    }
  };

  ws.onerror = (err): void => {
    console.error("[WS] Error:", err);
  };

  ws.onmessage = (event): void => {
    try {
      const message = JSON.parse(event.data) as ServerMessage;
      handleServerMessage(message);
    } catch (err) {
      console.error("[WS] Parse error:", err);
    }
  };
}

/**
 * Handle incoming server messages
 */
function handleServerMessage(message: ServerMessage): void {
  console.log("[WS] Received:", message.type);

  switch (message.type) {
    case "sync_state":
      // Sync state from server
      if (message.pattern) {
        setEditorCode(message.pattern as string);
      }
      if (typeof message.playing === "boolean") {
        isPlaying = message.playing;
        updatePlayButton();
      }
      if (typeof message.cps === "number") {
        const bpm = Math.round((message.cps * 60) / 0.5);
        tempoInput.value = String(bpm);
      }
      break;

    case "set_pattern":
      setEditorCode(message.code as string);
      if (message.autoplay) {
        playPattern();
      }
      break;

    case "transport_control":
      if (message.action === "play") {
        playPattern();
      } else if (message.action === "stop") {
        stopPattern();
      }
      break;

    case "set_cps":
      if (typeof message.cps === "number") {
        const bpm = Math.round((message.cps * 60) / 0.5);
        tempoInput.value = String(bpm);
        if (strudelRepl && controls) {
          controls.setCps(message.cps);
        }
        strudelMirror?.repl?.setCps?.(message.cps);
      }
      break;

    case "evaluate":
      evaluateCode(message.code as string);
      break;

    case "agent_response":
    case "assistant_message":
      addMessage("assistant", message.content as string);
      showThinking(false);
      break;

    case "assistant_chunk":
      appendToLastMessage(message.content as string);
      break;

    case "tool_start":
    case "tool_use":
      addMessage("tool", `Using tool: ${message.name}`);
      break;

    case "tool_result": {
      const resultText =
        typeof message.output === "string"
          ? message.output
          : typeof message.result === "string"
            ? message.result
            : JSON.stringify(message.output ?? message.result, null, 2);
      addMessage(
        "tool",
        `Result: ${resultText.slice(0, 100)}${resultText.length > 100 ? "..." : ""}`
      );
      break;
    }

    case "agent_thinking":
    case "thinking":
      showThinking(true);
      break;

    case "done":
      showThinking(false);
      break;

    case "error":
      addMessage("error", message.message as string);
      showThinking(false);
      break;

    default:
      console.log("[WS] Unknown message type:", message.type);
  }
}

/**
 * Send message to server
 */
function send(message: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.error("[WS] Not connected");
  }
}

function sendClientLog(level: "error" | "warn" | "info", message: string, stack?: string): void {
  send({ type: "client_log", level, message, stack });
}

/**
 * Play the current pattern
 */
async function playPattern(): Promise<void> {
  await ensureStrudel();

  // Prefer StrudelMirror — it has the Drawer+highlighting built in
  if (strudelMirror) {
    try {
      await strudelMirror.evaluate(true);
      isPlaying = true;
      updatePlayButton();
      updateStatus("Playing", "playing");
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[StrudelMirror] Eval error:", err);
      sendClientLog("error", `Eval error: ${msg}`, err instanceof Error ? err.stack : undefined);
      updateStatus("Error", "error");
      return;
    }
  }

  // Fallback: use initStrudel REPL (no highlighting)
  const code = getEditorCode();
  if (strudelRepl) {
    try {
      await strudelRepl.evaluate(code);
      isPlaying = true;
      updatePlayButton();
      updateStatus("Playing", "playing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Strudel] Eval error:", err);
      sendClientLog("error", `Eval error: ${msg}`, err instanceof Error ? err.stack : undefined);
      updateStatus("Error", "error");
    }
  } else {
    console.error("[Strudel] Not initialized, cannot play");
    sendClientLog("error", "Strudel not initialized, cannot play");
  }
}

/**
 * Stop playback
 */
async function stopPattern(): Promise<void> {
  if (strudelMirror) {
    try {
      await strudelMirror.stop();
    } catch (err) {
      console.error("[StrudelMirror] Stop error:", err);
    }
  }
  try { hush(); } catch (_) { /* hush() requires initStrudel repl; safe to ignore */ }
  isPlaying = false;
  updatePlayButton();
  updateStatus("Stopped");
  drawCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
}

/**
 * Evaluate code without changing play state
 */
async function evaluateCode(code: string): Promise<void> {
  await ensureStrudel();

  // When using StrudelMirror, set the code in the editor first, then evaluate
  if (strudelMirror) {
    setEditorCode(code);
    try {
      await strudelMirror.evaluate(false);
      updateStatus("Evaluated", "playing");
    } catch (err) {
      console.error("[StrudelMirror] Eval error:", err);
      updateStatus("Error", "error");
    }
    return;
  }

  // Fallback
  if (strudelRepl) {
    try {
      await strudelRepl.evaluate(code);
      updateStatus("Evaluated", "playing");
    } catch (err) {
      console.error("[Strudel] Eval error:", err);
      updateStatus("Error", "error");
    }
  }
}

/**
 * Update play button state
 */
function updatePlayButton(): void {
  if (isPlaying) {
    btnPlay.classList.add("playing");
    btnPlay.textContent = "⏸ Pause";
  } else {
    btnPlay.classList.remove("playing");
    btnPlay.textContent = "▶ Play";
  }
}

/**
 * Update status indicator
 */
function updateStatus(text: string, className?: string): void {
  statusIndicator.textContent = text;
  statusIndicator.className = "status";
  if (className) {
    statusIndicator.classList.add(className);
  }
}

type MessageRole = "user" | "assistant" | "tool" | "error";

/**
 * Add message to chat
 */
function addMessage(role: MessageRole, content: string): void {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";

  // Parse markdown-like content for assistant messages
  if (role === "assistant") {
    contentDiv.innerHTML = parseSimpleMarkdown(content);
  } else {
    contentDiv.textContent = content;
  }

  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Append content to the last assistant message (for streaming)
 */
function appendToLastMessage(content: string): void {
  const lastMessage = chatMessages.querySelector(
    ".message.assistant:last-child .message-content"
  );
  if (lastMessage) {
    lastMessage.innerHTML = parseSimpleMarkdown((lastMessage.textContent || "") + content);
  } else {
    addMessage("assistant", content);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Simple markdown parser
 */
function parseSimpleMarkdown(text: string): string {
  return (
    text
      // Code blocks
      .replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Bold
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      // Line breaks
      .replace(/\n/g, "<br>")
  );
}

/**
 * Show/hide thinking indicator
 */
function showThinking(show: boolean): void {
  const existingIndicator = chatMessages.querySelector(".loading");
  if (show && !existingIndicator) {
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "loading";
    loadingDiv.textContent = "Thinking";
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (!show && existingIndicator) {
    existingIndicator.remove();
  }
}

// Event Listeners

// Play button
btnPlay.addEventListener("click", () => {
  if (isPlaying) {
    stopPattern();
    send({ type: "transport", action: "stop" });
  } else {
    playPattern();
    send({ type: "transport", action: "play" });
    send({ type: "pattern_update", code: getEditorCode() });
  }
});

// Stop button
btnStop.addEventListener("click", () => {
  stopPattern();
  send({ type: "transport", action: "stop" });
});

// Tempo change
tempoInput.addEventListener("change", () => {
  const bpm = Number.parseInt(tempoInput.value, 10);
  if (bpm >= 20 && bpm <= 300) {
    const cps = (bpm / 60) * 0.5;
    if (strudelRepl && controls) {
      controls.setCps(cps);
    }
    strudelMirror?.repl?.setCps?.(cps);
    // Don't send to server - agent controls tempo
  }
});

// Chat form
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (message) {
    // Sync current editor content to server before agent runs
    send({ type: "pattern_update", code: getEditorCode() });
    addMessage("user", message);
    send({ type: "chat", message });
    chatInput.value = "";
    showThinking(true);
  }
});

// Enter to send (Shift+Enter for newline)
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

// Keyboard shortcuts (global — CodeMirror handles its own Ctrl+Enter)
document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + . to stop
  if ((e.ctrlKey || e.metaKey) && e.key === ".") {
    e.preventDefault();
    stopPattern();
    send({ type: "transport", action: "stop" });
  }
});

// Resizable panes
let isResizing = false;
resizeHandle.addEventListener("mousedown", () => {
  isResizing = true;
  resizeHandle.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", (e) => {
  if (!isResizing) return;

  const container = document.querySelector(".main");
  if (!container) return;

  const containerWidth = container.getBoundingClientRect().width;
  const newWidth = e.clientX;
  const minWidth = 300;
  const maxWidth = containerWidth - 280;

  if (newWidth >= minWidth && newWidth <= maxWidth) {
    editorPane.style.flex = "none";
    editorPane.style.width = `${newWidth}px`;
    resizeVizCanvas();
  }
});

document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
});

// Initialize on load
document.addEventListener("DOMContentLoaded", async () => {
  const defaultCode = `// Welcome to Apfelstrudel! 🥧
// Press Play or Ctrl+Enter, or ask the AI!

stack(
  s("bd [~ bd] sd [bd ~ ]"),
  s("[~ hh]*4").gain(.6),
  note("<c2 [c2 eb2] f2 [f2 ab2]>")
    .s("sawtooth").lpf(600).decay(.15).sustain(0),
  note("<[c4 eb4 g4] [f4 ab4 c5] [eb4 g4 bb4] [ab4 c5 eb5]>/2")
    .s("triangle").gain(.35).delay(.25).room(.3)
)`;

  // Wait for dynamic codemirror import, then set up editor
  await codemirrorReady;

  // Pre-create a low-latency AudioContext so Strudel doesn't fall back to
  // the default "balanced" hint (which adds ~50-100ms of buffer latency).
  const ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 44100 });
  setAudioContext(ctx);

  if (StrudelMirrorCtor) {
    try {
      strudelMirror = new StrudelMirrorCtor({
        root: editorRoot,
        initialCode: defaultCode,
        drawContext: drawCtx,
        transpiler,
        defaultOutput: webaudioOutput,
        getTime: getAudioTime,
        editPattern: (pat: unknown) =>
          (pat as { pianoroll: (opts: Record<string, unknown>) => unknown }).pianoroll({ ctx: drawCtx, cycles: 8, playhead: 0.5 }),
        prebake: async () => {
          const webModule = await import("@strudel/web");
          const miniModule = await import("@strudel/mini");
          const webaudioModule = await import("@strudel/webaudio");
          const drawModule = await import("@strudel/draw");
          await evalScope(webModule, miniModule, webaudioModule, drawModule);
          // Register built-in synth oscillators (sawtooth, triangle, etc.) and ZZFX sounds
          const regSynth = (webModule as Record<string, unknown>).registerSynthSounds as (() => void) | undefined;
          const regZZFX = (webModule as Record<string, unknown>).registerZZFXSounds as (() => void) | undefined;
          regSynth?.();
          regZZFX?.();
          await ensureSamplesLoaded();
        },
      });

      // Protect against library bug: StrudelMirror.afterEval sets
      // this.widgets = options.meta?.widgets which can be undefined,
      // then calls this.widgets.filter() → crash.
      // Use a property trap so .widgets/.miniLocations always return arrays.
      const safeArray = (target: Record<string, unknown>, prop: string) => {
        let value: unknown[] = [];
        Object.defineProperty(target, prop, {
          get: () => value,
          set: (v: unknown) => { value = Array.isArray(v) ? v : []; },
          configurable: true,
        });
      };
      safeArray(strudelMirror, "widgets");
      safeArray(strudelMirror, "miniLocations");
      editorView = strudelMirror.editor;
      strudelMirror.reconfigureExtension?.("isPatternHighlightingEnabled", true);
      console.log("[Editor] StrudelMirror initialized");
    } catch (err) {
      console.error("[Editor] StrudelMirror init failed:", err);
    }
  }

  // Fallback to textarea if CodeMirror didn't initialize
  if (!editorView) {
    console.warn("[Editor] Using textarea fallback");
    const fallback = document.createElement("textarea");
    fallback.id = "code-editor-fallback";
    fallback.value = defaultCode;
    fallback.style.cssText = "width:100%;height:100%;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font-mono);font-size:0.9375rem;border:none;padding:0.5rem;resize:none;";
    editorRoot.appendChild(fallback);
  }

  connectWebSocket();

  // Defer strudel init to first user interaction (AudioContext requires gesture)
  const initOnGesture = async () => {
    document.removeEventListener("pointerdown", initOnGesture);
    document.removeEventListener("keydown", initOnGesture);

    const audioCtx = getAudioContext();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch((err) => console.warn("[Audio] Resume failed", err));
    }

    // Load AudioWorklets + samples (prebake already ran evalScope & registered synths)
    await initAudio();
    await ensureSamplesLoaded();

    if (!strudelMirror) {
      // Fallback: init full REPL
      await initializeStrudel();
    }

    updateStatus("Ready");
  };
  document.addEventListener("pointerdown", initOnGesture);
  document.addEventListener("keydown", initOnGesture);
});

// Forward browser errors to the server for debugging
window.addEventListener("error", (event) => {
  const message = event.message ?? "Unknown error";
  const stack = event.error?.stack ?? String(event.error ?? "");
  sendClientLog("error", message, stack);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason ?? "Unhandled rejection";
  const message = typeof reason === "string" ? reason : JSON.stringify(reason);
  sendClientLog("error", message);
});
