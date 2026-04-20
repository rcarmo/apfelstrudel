var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/client/app.ts
import { initStrudel, controls, hush, evalScope, transpiler, samples, webaudioOutput } from "@strudel/web";
import { getAudioContext, setAudioContext, initAudio } from "@strudel/webaudio";
var StrudelMirrorCtor = null;
var _cmSpec = "@strudel/codemirror";
var codemirrorReady = import(_cmSpec).then((mod) => {
  StrudelMirrorCtor = mod.StrudelMirror;
  console.log("[Editor] @strudel/codemirror loaded");
}).catch((err) => {
  console.error("[Editor] Failed to load @strudel/codemirror:", err);
});
var editorRoot = document.getElementById("code-editor");
var tabsContainer = document.getElementById("tabs-container");
var fileInput = document.getElementById("file-input");
var btnUndo = document.getElementById("btn-undo");
var btnRedo = document.getElementById("btn-redo");
var chatMessages = document.getElementById("chat-messages");
var chatForm = document.getElementById("chat-form");
var chatInput = document.getElementById("chat-input");
var btnPlay = document.getElementById("btn-play");
var btnStop = document.getElementById("btn-stop");
var tempoInput = document.getElementById("tempo");
var statusIndicator = document.getElementById("status-indicator");
var resizeHandle = document.getElementById("resize-handle");
var editorPane = document.querySelector(".editor-pane");
var vizContainer = document.getElementById("visualization");
var vizCanvas = document.createElement("canvas");
vizCanvas.id = "pianoroll-canvas";
vizContainer.appendChild(vizCanvas);
function resizeVizCanvas() {
  const r = window.devicePixelRatio || 1;
  vizCanvas.width = vizContainer.clientWidth * r;
  vizCanvas.height = vizContainer.clientHeight * r;
}
resizeVizCanvas();
window.addEventListener("resize", resizeVizCanvas);
var drawCtx = vizCanvas.getContext("2d");
function getAudioTime() {
  return getAudioContext().currentTime;
}
var samplesLoaded = false;
async function ensureSamplesLoaded() {
  if (samplesLoaded)
    return;
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
var ws = null;
var isPlaying = false;
var reconnectAttempts = 0;
var maxReconnectAttempts = 5;
var sessionState = { tabs: [], activeTabId: "" };
var historyStack = {};
var lastSetCode = "";
var strudelRepl = null;
var strudelInitPromise = null;
var editorView = null;
var strudelMirror = null;
function getEditorCode() {
  if (editorView?.state?.doc)
    return editorView.state.doc.toString();
  const fb = document.getElementById("code-editor-fallback");
  return fb?.value ?? "";
}
function setEditorCode(code) {
  lastSetCode = code;
  if (editorView) {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: code }
    });
    return;
  }
  const fb = document.getElementById("code-editor-fallback");
  if (fb)
    fb.value = code;
}
function renderTabs() {
  tabsContainer.innerHTML = "";
  sessionState.tabs.forEach((tab) => {
    const tabEl = document.createElement("div");
    tabEl.className = `tab ${tab.id === sessionState.activeTabId ? "active" : ""}`;
    const titleEl = document.createElement("span");
    titleEl.className = "tab-title";
    titleEl.textContent = tab.title;
    titleEl.onclick = () => {
      if (tab.id !== sessionState.activeTabId) {
        send({ type: "switch_tab", id: tab.id });
      }
    };
    titleEl.ondblclick = (e) => {
      e.stopPropagation();
      const newTitle = prompt("Enter new tab title:", tab.title);
      if (newTitle && newTitle.trim()) {
        send({ type: "rename_tab", id: tab.id, title: newTitle.trim() });
      }
    };
    const closeEl = document.createElement("span");
    closeEl.className = "tab-close";
    closeEl.textContent = "×";
    closeEl.onclick = (e) => {
      e.stopPropagation();
      handleCloseTab(tab);
    };
    tabEl.appendChild(titleEl);
    tabEl.appendChild(closeEl);
    tabsContainer.appendChild(tabEl);
  });
  const addTabEl = document.createElement("div");
  addTabEl.className = "tab-add";
  addTabEl.textContent = "+";
  addTabEl.title = "New Tab";
  addTabEl.onclick = () => send({ type: "create_tab" });
  tabsContainer.appendChild(addTabEl);
  const readTabEl = document.createElement("div");
  readTabEl.className = "tab-add";
  readTabEl.innerHTML = "\uD83D\uDCC2";
  readTabEl.title = "Read from file";
  readTabEl.onclick = () => fileInput.click();
  tabsContainer.appendChild(readTabEl);
  const saveTabEl = document.createElement("div");
  saveTabEl.className = "tab-add";
  saveTabEl.innerHTML = "\uD83D\uDCBE";
  saveTabEl.title = "Save to file";
  saveTabEl.onclick = async () => {
    const activeTab = sessionState.tabs.find((t) => t.id === sessionState.activeTabId);
    if (activeTab) {
      await downloadFile(`${activeTab.title}.strudel`, activeTab.content);
    }
  };
  tabsContainer.appendChild(saveTabEl);
}
async function handleCloseTab(tab) {
  if (sessionState.tabs.length <= 1)
    return;
  const save = confirm(`Do you want to save the script "${tab.title}" to a file before closing?`);
  if (save) {
    await downloadFile(`${tab.title}.strudel`, tab.content);
  }
  send({ type: "close_tab", id: tab.id });
}
async function downloadFile(filename, content) {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Strudel Script",
            accept: { "text/javascript": [".strudel", ".js", ".txt"] }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === "AbortError")
        return;
      console.error("File System Access API failed, falling back to download:", err);
    }
  }
  const blob = new Blob([content], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function getHistory(tabId) {
  if (!historyStack[tabId]) {
    historyStack[tabId] = { past: [], future: [] };
  }
  return historyStack[tabId];
}
function pushHistory(tabId, content) {
  const h = getHistory(tabId);
  if (h.past.length > 0 && h.past[h.past.length - 1] === content)
    return;
  h.past.push(content);
  if (h.past.length > 100)
    h.past.shift();
  h.future = [];
  updateHistoryButtons();
}
function undo() {
  const tabId = sessionState.activeTabId;
  const h = getHistory(tabId);
  if (h.past.length === 0)
    return;
  const current = getEditorCode();
  h.future.push(current);
  const prev = h.past.pop();
  setEditorCode(prev);
  send({ type: "pattern_update", code: prev });
  updateHistoryButtons();
}
function redo() {
  const tabId = sessionState.activeTabId;
  const h = getHistory(tabId);
  if (h.future.length === 0)
    return;
  const current = getEditorCode();
  h.past.push(current);
  const next = h.future.pop();
  setEditorCode(next);
  send({ type: "pattern_update", code: next });
  updateHistoryButtons();
}
function updateHistoryButtons() {
  const h = getHistory(sessionState.activeTabId);
  btnUndo.disabled = h.past.length === 0;
  btnRedo.disabled = h.future.length === 0;
  btnUndo.style.opacity = btnUndo.disabled ? "0.3" : "1";
  btnRedo.style.opacity = btnRedo.disabled ? "0.3" : "1";
}
async function initializeStrudel() {
  if (strudelRepl)
    return;
  if (strudelMirror)
    return;
  if (strudelInitPromise)
    return strudelInitPromise;
  strudelInitPromise = (async () => {
    try {
      strudelRepl = await initStrudel({
        editPattern: (pat) => pat.pianoroll({ ctx: drawCtx, cycles: 8, playhead: 0.5 }),
        prebake: async () => {
          const miniModule = await import("@strudel/mini");
          const webaudioModule = await import("@strudel/webaudio");
          const drawModule = await import("@strudel/draw");
          await evalScope(miniModule, webaudioModule, drawModule);
        }
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
async function ensureStrudel() {
  if (strudelMirror)
    return;
  if (!strudelRepl)
    await initializeStrudel();
}
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    console.log("[WS] Connected");
    reconnectAttempts = 0;
    updateStatus("Connected");
  };
  ws.onclose = () => {
    console.log("[WS] Disconnected");
    updateStatus("Disconnected", "error");
    ws = null;
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 1e4);
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
      setTimeout(connectWebSocket, delay);
    }
  };
  ws.onerror = (err) => {
    console.error("[WS] Error:", err);
  };
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleServerMessage(message);
    } catch (err) {
      console.error("[WS] Parse error:", err);
    }
  };
}
function handleServerMessage(message) {
  console.log("[WS] Received:", message.type);
  switch (message.type) {
    case "session_update": {
      const oldActiveId = sessionState.activeTabId;
      sessionState = message.session;
      renderTabs();
      updateHistoryButtons();
      if (sessionState.activeTabId !== oldActiveId) {
        const activeTab = sessionState.tabs.find((t) => t.id === sessionState.activeTabId);
        if (activeTab) {
          setEditorCode(activeTab.content);
        }
      }
      break;
    }
    case "sync_state":
      if (message.pattern) {
        const newCode = message.pattern;
        if (newCode !== getEditorCode()) {
          setEditorCode(newCode);
        }
      }
      if (typeof message.playing === "boolean") {
        isPlaying = message.playing;
        updatePlayButton();
      }
      if (typeof message.cps === "number") {
        const bpm = Math.round(message.cps * 60 / 0.5);
        tempoInput.value = String(bpm);
      }
      break;
    case "set_pattern": {
      const newCode = message.code;
      if (newCode !== getEditorCode()) {
        pushHistory(sessionState.activeTabId, getEditorCode());
        setEditorCode(newCode);
      }
      if (message.autoplay) {
        playPattern();
      }
      break;
    }
    case "transport_control":
      if (message.action === "play") {
        playPattern();
      } else if (message.action === "stop") {
        stopPattern();
      }
      break;
    case "set_cps":
      if (typeof message.cps === "number") {
        const bpm = Math.round(message.cps * 60 / 0.5);
        tempoInput.value = String(bpm);
        if (strudelRepl && controls) {
          controls.setCps(message.cps);
        }
        strudelMirror?.repl?.setCps?.(message.cps);
      }
      break;
    case "evaluate":
      evaluateCode(message.code);
      break;
    case "agent_response":
    case "assistant_message":
      addMessage("assistant", message.content);
      showThinking(false);
      break;
    case "assistant_chunk":
      appendToLastMessage(message.content);
      break;
    case "tool_start":
    case "tool_use":
      addMessage("tool", `Using tool: ${message.name}`);
      break;
    case "tool_result": {
      const resultText = typeof message.output === "string" ? message.output : typeof message.result === "string" ? message.result : JSON.stringify(message.output ?? message.result, null, 2);
      addMessage("tool", `Result: ${resultText.slice(0, 100)}${resultText.length > 100 ? "..." : ""}`);
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
      addMessage("error", message.message);
      showThinking(false);
      break;
    default:
      console.log("[WS] Unknown message type:", message.type);
  }
}
function send(message) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.error("[WS] Not connected");
  }
}
function sendClientLog(level, message, stack) {
  send({ type: "client_log", level, message, stack });
}
async function playPattern() {
  await ensureStrudel();
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
async function stopPattern() {
  if (strudelMirror) {
    try {
      await strudelMirror.stop();
    } catch (err) {
      console.error("[StrudelMirror] Stop error:", err);
    }
  }
  try {
    hush();
  } catch (_) {}
  isPlaying = false;
  updatePlayButton();
  updateStatus("Stopped");
  drawCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
}
async function evaluateCode(code) {
  await ensureStrudel();
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
function updatePlayButton() {
  if (isPlaying) {
    btnPlay.classList.add("playing");
    btnPlay.textContent = "⏸ Pause";
  } else {
    btnPlay.classList.remove("playing");
    btnPlay.textContent = "▶ Play";
  }
}
function updateStatus(text, className) {
  statusIndicator.textContent = text;
  statusIndicator.className = "status";
  if (className) {
    statusIndicator.classList.add(className);
  }
}
function addMessage(role, content) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  if (role === "assistant") {
    contentDiv.innerHTML = parseSimpleMarkdown(content);
  } else {
    contentDiv.textContent = content;
  }
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
function appendToLastMessage(content) {
  const lastMessage = chatMessages.querySelector(".message.assistant:last-child .message-content");
  if (lastMessage) {
    lastMessage.innerHTML = parseSimpleMarkdown((lastMessage.textContent || "") + content);
  } else {
    addMessage("assistant", content);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
function parseSimpleMarkdown(text) {
  return text.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/\n/g, "<br>");
}
function showThinking(show) {
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
btnStop.addEventListener("click", () => {
  stopPattern();
  send({ type: "transport", action: "stop" });
});
tempoInput.addEventListener("change", () => {
  const bpm = Number.parseInt(tempoInput.value, 10);
  if (bpm >= 20 && bpm <= 300) {
    const cps = bpm / 60 * 0.5;
    if (strudelRepl && controls) {
      controls.setCps(cps);
    }
    strudelMirror?.repl?.setCps?.(cps);
  }
});
btnUndo.addEventListener("click", undo);
btnRedo.addEventListener("click", redo);
fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file)
    return;
  const fileName = file.name.replace(/\.[^/.]+$/, "");
  const reader = new FileReader;
  reader.onload = (event) => {
    const content = event.target?.result;
    if (content) {
      pushHistory(sessionState.activeTabId, getEditorCode());
      setEditorCode(content);
      send({ type: "pattern_update", code: content });
      send({ type: "rename_tab", id: sessionState.activeTabId, title: fileName });
    }
  };
  reader.readAsText(file);
});
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (message) {
    pushHistory(sessionState.activeTabId, getEditorCode());
    send({ type: "pattern_update", code: getEditorCode() });
    addMessage("user", message);
    send({ type: "chat", message });
    chatInput.value = "";
    showThinking(true);
  }
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === ".") {
    e.preventDefault();
    stopPattern();
    send({ type: "transport", action: "stop" });
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    if (document.activeElement !== chatInput) {
      e.preventDefault();
      undo();
    }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Z" && e.shiftKey)) {
    if (document.activeElement !== chatInput) {
      e.preventDefault();
      redo();
    }
  }
});
var isResizing = false;
resizeHandle.addEventListener("mousedown", () => {
  isResizing = true;
  resizeHandle.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
});
document.addEventListener("mousemove", (e) => {
  if (!isResizing)
    return;
  const container = document.querySelector(".main");
  if (!container)
    return;
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
document.addEventListener("DOMContentLoaded", async () => {
  const defaultCode = `// Welcome to Apfelstrudel! \uD83E\uDD67
// Press Play or Ctrl+Enter, or ask the AI!

stack(
  s("bd [~ bd] sd [bd ~ ]"),
  s("[~ hh]*4").gain(.6),
  note("<c2 [c2 eb2] f2 [f2 ab2]>")
    .s("sawtooth").lpf(600).decay(.15).sustain(0),
  note("<[c4 eb4 g4] [f4 ab4 c5] [eb4 g4 bb4] [ab4 c5 eb5]>/2")
    .s("triangle").gain(.35).delay(.25).room(.3)
)`;
  await codemirrorReady;
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
        editPattern: (pat) => pat.pianoroll({ ctx: drawCtx, cycles: 8, playhead: 0.5 }),
        prebake: async () => {
          const webModule = await import("@strudel/web");
          const miniModule = await import("@strudel/mini");
          const webaudioModule = await import("@strudel/webaudio");
          const drawModule = await import("@strudel/draw");
          await evalScope(webModule, miniModule, webaudioModule, drawModule);
          const regSynth = webModule.registerSynthSounds;
          const regZZFX = webModule.registerZZFXSounds;
          regSynth?.();
          regZZFX?.();
          await ensureSamplesLoaded();
        }
      });
      const safeArray = (target, prop) => {
        let value = [];
        Object.defineProperty(target, prop, {
          get: () => value,
          set: (v) => {
            value = Array.isArray(v) ? v : [];
          },
          configurable: true
        });
      };
      safeArray(strudelMirror, "widgets");
      safeArray(strudelMirror, "miniLocations");
      editorView = strudelMirror.editor;
      strudelMirror.reconfigureExtension?.("isPatternHighlightingEnabled", true);
      let updateTimeout = null;
      strudelMirror.onUpdate?.((code) => {
        if (code === lastSetCode)
          return;
        if (updateTimeout)
          clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
          send({ type: "pattern_update", code });
          updateTimeout = null;
        }, 500);
      });
      console.log("[Editor] StrudelMirror initialized");
    } catch (err) {
      console.error("[Editor] StrudelMirror init failed:", err);
    }
  }
  if (!editorView) {
    console.warn("[Editor] Using textarea fallback");
    const fallback = document.createElement("textarea");
    fallback.id = "code-editor-fallback";
    fallback.value = defaultCode;
    fallback.style.cssText = "width:100%;height:100%;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font-mono);font-size:0.9375rem;border:none;padding:0.5rem;resize:none;";
    editorRoot.appendChild(fallback);
  }
  connectWebSocket();
  const initOnGesture = async () => {
    document.removeEventListener("pointerdown", initOnGesture);
    document.removeEventListener("keydown", initOnGesture);
    const audioCtx = getAudioContext();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch((err) => console.warn("[Audio] Resume failed", err));
    }
    await initAudio();
    await ensureSamplesLoaded();
    if (!strudelMirror) {
      await initializeStrudel();
    }
    updateStatus("Ready");
  };
  document.addEventListener("pointerdown", initOnGesture);
  document.addEventListener("keydown", initOnGesture);
});
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

//# debugId=57E7B633BDC9742A64756E2164756E21
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2NsaWVudC9hcHAudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbCiAgICAiLyoqXG4gKiBBcGZlbHN0cnVkZWwgRnJvbnRlbmQgQXBwbGljYXRpb25cbiAqIFdlYlNvY2tldCBjbGllbnQgKyBTdHJ1ZGVsLmNjIGludGVncmF0aW9uXG4gKlxuICogTk9URTogQWxsIGRlcGVuZGVuY2llcyBhcmUgdmVuZG9yZWQgaW4gL3ZlbmRvci9cbiAqIE5vIENETiBpbXBvcnRzIGFsbG93ZWQgLSBzZWUgLmdpdGh1Yi9jb3BpbG90LWluc3RydWN0aW9ucy5tZFxuICpcbiAqIFRoaXMgZmlsZSBpcyBidW5kbGVkIHRvIHB1YmxpYy9hcHAuanMgdmlhIGBtYWtlIGJ1aWxkLWNsaWVudGBcbiAqL1xuXG5pbXBvcnQgeyBpbml0U3RydWRlbCwgY29udHJvbHMsIGh1c2gsIGV2YWxTY29wZSwgdHJhbnNwaWxlciwgc2FtcGxlcywgd2ViYXVkaW9PdXRwdXQgfSBmcm9tIFwiQHN0cnVkZWwvd2ViXCI7XG5pbXBvcnQgeyBnZXRBdWRpb0NvbnRleHQsIHNldEF1ZGlvQ29udGV4dCwgaW5pdEF1ZGlvIH0gZnJvbSBcIkBzdHJ1ZGVsL3dlYmF1ZGlvXCI7XG5cbi8vIER5bmFtaWMgaW1wb3J0IHRvIHByZXZlbnQgdGhlIGVudGlyZSBhcHAgZnJvbSBmYWlsaW5nIGlmIGNvZGVtaXJyb3IgY2FuJ3QgbG9hZC5cbi8vIFRoZSBzcGVjaWZpZXIgaXMgY29uc3RydWN0ZWQgdmlhIGEgdmFyaWFibGUgdG8gcHJldmVudCBCdW4gZnJvbSBob2lzdGluZyBpdCB0byBhIHN0YXRpYyBpbXBvcnQuXG4vLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vRXhwbGljaXRBbnk6IGR5bmFtaWNhbGx5IGltcG9ydGVkIG1vZHVsZVxubGV0IFN0cnVkZWxNaXJyb3JDdG9yOiBhbnkgPSBudWxsO1xuY29uc3QgX2NtU3BlYyA9IFwiQHN0cnVkZWwvY29kZW1pcnJvclwiO1xuY29uc3QgY29kZW1pcnJvclJlYWR5ID0gaW1wb3J0KC8qIEB2aXRlLWlnbm9yZSAqLyBfY21TcGVjKVxuICAudGhlbigobW9kKSA9PiB7XG4gICAgU3RydWRlbE1pcnJvckN0b3IgPSBtb2QuU3RydWRlbE1pcnJvcjtcbiAgICBjb25zb2xlLmxvZyhcIltFZGl0b3JdIEBzdHJ1ZGVsL2NvZGVtaXJyb3IgbG9hZGVkXCIpO1xuICB9KVxuICAuY2F0Y2goKGVycikgPT4ge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJbRWRpdG9yXSBGYWlsZWQgdG8gbG9hZCBAc3RydWRlbC9jb2RlbWlycm9yOlwiLCBlcnIpO1xuICB9KTtcblxuLy8gVHlwZXNcbmludGVyZmFjZSBTZXJ2ZXJNZXNzYWdlIHtcbiAgdHlwZTogc3RyaW5nO1xuICBba2V5OiBzdHJpbmddOiB1bmtub3duO1xufVxuXG5pbnRlcmZhY2UgVGFiIHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgU2Vzc2lvblN0YXRlIHtcbiAgdGFiczogVGFiW107XG4gIGFjdGl2ZVRhYklkOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBIaXN0b3J5U3RhdGUge1xuICBwYXN0OiBzdHJpbmdbXTtcbiAgZnV0dXJlOiBzdHJpbmdbXTtcbn1cblxuLy8gYmlvbWUtaWdub3JlIGxpbnQvc3VzcGljaW91cy9ub0V4cGxpY2l0QW55OiBDb2RlTWlycm9yIEVkaXRvclZpZXcgdHlwZSBmcm9tIHZlbmRvcmVkIG1vZHVsZVxudHlwZSBFZGl0b3JWaWV3ID0gYW55O1xuXG4vLyBET00gRWxlbWVudHNcbmNvbnN0IGVkaXRvclJvb3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImNvZGUtZWRpdG9yXCIpIGFzIEhUTUxEaXZFbGVtZW50O1xuY29uc3QgdGFic0NvbnRhaW5lciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwidGFicy1jb250YWluZXJcIikgYXMgSFRNTERpdkVsZW1lbnQ7XG5jb25zdCBmaWxlSW5wdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImZpbGUtaW5wdXRcIikgYXMgSFRNTElucHV0RWxlbWVudDtcbmNvbnN0IGJ0blVuZG8gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImJ0bi11bmRvXCIpIGFzIEhUTUxCdXR0b25FbGVtZW50O1xuY29uc3QgYnRuUmVkbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiYnRuLXJlZG9cIikgYXMgSFRNTEJ1dHRvbkVsZW1lbnQ7XG5jb25zdCBjaGF0TWVzc2FnZXMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImNoYXQtbWVzc2FnZXNcIikgYXMgSFRNTERpdkVsZW1lbnQ7XG5jb25zdCBjaGF0Rm9ybSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiY2hhdC1mb3JtXCIpIGFzIEhUTUxGb3JtRWxlbWVudDtcbmNvbnN0IGNoYXRJbnB1dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiY2hhdC1pbnB1dFwiKSBhcyBIVE1MVGV4dEFyZWFFbGVtZW50O1xuY29uc3QgYnRuUGxheSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiYnRuLXBsYXlcIikgYXMgSFRNTEJ1dHRvbkVsZW1lbnQ7XG5jb25zdCBidG5TdG9wID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJidG4tc3RvcFwiKSBhcyBIVE1MQnV0dG9uRWxlbWVudDtcbmNvbnN0IHRlbXBvSW5wdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcInRlbXBvXCIpIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XG5jb25zdCBzdGF0dXNJbmRpY2F0b3IgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcInN0YXR1cy1pbmRpY2F0b3JcIikgYXMgSFRNTFNwYW5FbGVtZW50O1xuY29uc3QgcmVzaXplSGFuZGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJyZXNpemUtaGFuZGxlXCIpIGFzIEhUTUxEaXZFbGVtZW50O1xuY29uc3QgZWRpdG9yUGFuZSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIuZWRpdG9yLXBhbmVcIikgYXMgSFRNTEVsZW1lbnQ7XG5jb25zdCB2aXpDb250YWluZXIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcInZpc3VhbGl6YXRpb25cIikgYXMgSFRNTERpdkVsZW1lbnQ7XG5cbi8vIFNldCB1cCBwaWFub3JvbGwgY2FudmFzXG5jb25zdCB2aXpDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY2FudmFzXCIpO1xudml6Q2FudmFzLmlkID0gXCJwaWFub3JvbGwtY2FudmFzXCI7XG52aXpDb250YWluZXIuYXBwZW5kQ2hpbGQodml6Q2FudmFzKTtcbmZ1bmN0aW9uIHJlc2l6ZVZpekNhbnZhcygpOiB2b2lkIHtcbiAgY29uc3QgciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7XG4gIHZpekNhbnZhcy53aWR0aCA9IHZpekNvbnRhaW5lci5jbGllbnRXaWR0aCAqIHI7XG4gIHZpekNhbnZhcy5oZWlnaHQgPSB2aXpDb250YWluZXIuY2xpZW50SGVpZ2h0ICogcjtcbn1cbnJlc2l6ZVZpekNhbnZhcygpO1xud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJyZXNpemVcIiwgcmVzaXplVml6Q2FudmFzKTtcbmNvbnN0IGRyYXdDdHggPSB2aXpDYW52YXMuZ2V0Q29udGV4dChcIjJkXCIpIGFzIENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRDtcblxuZnVuY3Rpb24gZ2V0QXVkaW9UaW1lKCk6IG51bWJlciB7XG4gIHJldHVybiBnZXRBdWRpb0NvbnRleHQoKS5jdXJyZW50VGltZTtcbn1cblxubGV0IHNhbXBsZXNMb2FkZWQgPSBmYWxzZTtcbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZVNhbXBsZXNMb2FkZWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChzYW1wbGVzTG9hZGVkKSByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgc2FtcGxlcyhcIi92ZW5kb3Ivc3RydWRlbC9zYW1wbGVzL3N0cnVkZWwuanNvblwiKTtcbiAgICBjb25zb2xlLmxvZyhcIltTYW1wbGVzXSBMb2FkZWQgbG9jYWwgc2FtcGxlc1wiKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcihcIltTYW1wbGVzXSBGYWlsZWQgdG8gbG9hZCBsb2NhbCBzYW1wbGVzOlwiLCBlcnIpO1xuICB9XG4gIHRyeSB7XG4gICAgYXdhaXQgc2FtcGxlcyhcIi92ZW5kb3Ivc3RydWRlbC9zYW1wbGVzL2RpcnQtc2FtcGxlcy5qc29uXCIpO1xuICAgIGNvbnNvbGUubG9nKFwiW1NhbXBsZXNdIExvYWRlZCBEaXJ0LVNhbXBsZXMgbWFuaWZlc3RcIik7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJbU2FtcGxlc10gRmFpbGVkIHRvIGxvYWQgRGlydC1TYW1wbGVzOlwiLCBlcnIpO1xuICB9XG4gIHNhbXBsZXNMb2FkZWQgPSB0cnVlO1xufVxuXG4vLyBTdGF0ZVxubGV0IHdzOiBXZWJTb2NrZXQgfCBudWxsID0gbnVsbDtcbmxldCBpc1BsYXlpbmcgPSBmYWxzZTtcbmxldCByZWNvbm5lY3RBdHRlbXB0cyA9IDA7XG5jb25zdCBtYXhSZWNvbm5lY3RBdHRlbXB0cyA9IDU7XG5cbmxldCBzZXNzaW9uU3RhdGU6IFNlc3Npb25TdGF0ZSA9IHsgdGFiczogW10sIGFjdGl2ZVRhYklkOiBcIlwiIH07XG5jb25zdCBoaXN0b3J5U3RhY2s6IHsgW3RhYklkOiBzdHJpbmddOiBIaXN0b3J5U3RhdGUgfSA9IHt9O1xubGV0IGxhc3RTZXRDb2RlID0gXCJcIjsgLy8gVG8gdHJhY2sgd2hhdCB3ZSBsYXN0IHNldCBwcm9ncmFtbWF0aWNhbGx5XG5cbi8vIFN0cnVkZWwgKyBDb2RlTWlycm9yIGluc3RhbmNlc1xubGV0IHN0cnVkZWxSZXBsOiBBd2FpdGVkPFJldHVyblR5cGU8dHlwZW9mIGluaXRTdHJ1ZGVsPj4gfCBudWxsID0gbnVsbDtcbmxldCBzdHJ1ZGVsSW5pdFByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsID0gbnVsbDtcbmxldCBlZGl0b3JWaWV3OiBFZGl0b3JWaWV3IHwgbnVsbCA9IG51bGw7XG4vLyBiaW9tZS1pZ25vcmUgbGludC9zdXNwaWNpb3VzL25vRXhwbGljaXRBbnk6IFN0cnVkZWxNaXJyb3IgdHlwZSBmcm9tIHZlbmRvcmVkIG1vZHVsZVxubGV0IHN0cnVkZWxNaXJyb3I6IGFueSB8IG51bGwgPSBudWxsO1xuXG4vKiogR2V0IHRoZSBjdXJyZW50IGNvZGUgZnJvbSB0aGUgQ29kZU1pcnJvciBlZGl0b3IgKG9yIGZhbGxiYWNrIHRleHRhcmVhKSAqL1xuZnVuY3Rpb24gZ2V0RWRpdG9yQ29kZSgpOiBzdHJpbmcge1xuICBpZiAoZWRpdG9yVmlldz8uc3RhdGU/LmRvYykgcmV0dXJuIGVkaXRvclZpZXcuc3RhdGUuZG9jLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGZiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJjb2RlLWVkaXRvci1mYWxsYmFja1wiKSBhcyBIVE1MVGV4dEFyZWFFbGVtZW50IHwgbnVsbDtcbiAgcmV0dXJuIGZiPy52YWx1ZSA/PyBcIlwiO1xufVxuXG4vKiogU2V0IHRoZSBjb2RlIGluIHRoZSBDb2RlTWlycm9yIGVkaXRvciAob3IgZmFsbGJhY2sgdGV4dGFyZWEpICovXG5mdW5jdGlvbiBzZXRFZGl0b3JDb2RlKGNvZGU6IHN0cmluZyk6IHZvaWQge1xuICBsYXN0U2V0Q29kZSA9IGNvZGU7XG4gIGlmIChlZGl0b3JWaWV3KSB7XG4gICAgZWRpdG9yVmlldy5kaXNwYXRjaCh7XG4gICAgICBjaGFuZ2VzOiB7IGZyb206IDAsIHRvOiBlZGl0b3JWaWV3LnN0YXRlLmRvYy5sZW5ndGgsIGluc2VydDogY29kZSB9LFxuICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBmYiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiY29kZS1lZGl0b3ItZmFsbGJhY2tcIikgYXMgSFRNTFRleHRBcmVhRWxlbWVudCB8IG51bGw7XG4gIGlmIChmYikgZmIudmFsdWUgPSBjb2RlO1xufVxuXG4vKiogUmVuZGVyIHRoZSB0YWIgYmFyICovXG5mdW5jdGlvbiByZW5kZXJUYWJzKCk6IHZvaWQge1xuICB0YWJzQ29udGFpbmVyLmlubmVySFRNTCA9IFwiXCI7XG5cbiAgc2Vzc2lvblN0YXRlLnRhYnMuZm9yRWFjaCgodGFiKSA9PiB7XG4gICAgY29uc3QgdGFiRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRhYkVsLmNsYXNzTmFtZSA9IGB0YWIgJHt0YWIuaWQgPT09IHNlc3Npb25TdGF0ZS5hY3RpdmVUYWJJZCA/IFwiYWN0aXZlXCIgOiBcIlwifWA7XG5cbiAgICBjb25zdCB0aXRsZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgdGl0bGVFbC5jbGFzc05hbWUgPSBcInRhYi10aXRsZVwiO1xuICAgIHRpdGxlRWwudGV4dENvbnRlbnQgPSB0YWIudGl0bGU7XG4gICAgdGl0bGVFbC5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgaWYgKHRhYi5pZCAhPT0gc2Vzc2lvblN0YXRlLmFjdGl2ZVRhYklkKSB7XG4gICAgICAgIHNlbmQoeyB0eXBlOiBcInN3aXRjaF90YWJcIiwgaWQ6IHRhYi5pZCB9KTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHRpdGxlRWwub25kYmxjbGljayA9IChlKSA9PiB7XG4gICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgY29uc3QgbmV3VGl0bGUgPSBwcm9tcHQoXCJFbnRlciBuZXcgdGFiIHRpdGxlOlwiLCB0YWIudGl0bGUpO1xuICAgICAgaWYgKG5ld1RpdGxlICYmIG5ld1RpdGxlLnRyaW0oKSkge1xuICAgICAgICBzZW5kKHsgdHlwZTogXCJyZW5hbWVfdGFiXCIsIGlkOiB0YWIuaWQsIHRpdGxlOiBuZXdUaXRsZS50cmltKCkgfSk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGNvbnN0IGNsb3NlRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBjbG9zZUVsLmNsYXNzTmFtZSA9IFwidGFiLWNsb3NlXCI7XG4gICAgY2xvc2VFbC50ZXh0Q29udGVudCA9IFwiw5dcIjtcbiAgICBjbG9zZUVsLm9uY2xpY2sgPSAoZSkgPT4ge1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGhhbmRsZUNsb3NlVGFiKHRhYik7XG4gICAgfTtcblxuICAgIHRhYkVsLmFwcGVuZENoaWxkKHRpdGxlRWwpO1xuICAgIHRhYkVsLmFwcGVuZENoaWxkKGNsb3NlRWwpO1xuICAgIHRhYnNDb250YWluZXIuYXBwZW5kQ2hpbGQodGFiRWwpO1xuICB9KTtcblxuICBjb25zdCBhZGRUYWJFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIGFkZFRhYkVsLmNsYXNzTmFtZSA9IFwidGFiLWFkZFwiO1xuICBhZGRUYWJFbC50ZXh0Q29udGVudCA9IFwiK1wiO1xuICBhZGRUYWJFbC50aXRsZSA9IFwiTmV3IFRhYlwiO1xuICBhZGRUYWJFbC5vbmNsaWNrID0gKCkgPT4gc2VuZCh7IHR5cGU6IFwiY3JlYXRlX3RhYlwiIH0pO1xuICB0YWJzQ29udGFpbmVyLmFwcGVuZENoaWxkKGFkZFRhYkVsKTtcblxuICBjb25zdCByZWFkVGFiRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICByZWFkVGFiRWwuY2xhc3NOYW1lID0gXCJ0YWItYWRkXCI7XG4gIHJlYWRUYWJFbC5pbm5lckhUTUwgPSBcIvCfk4JcIjtcbiAgcmVhZFRhYkVsLnRpdGxlID0gXCJSZWFkIGZyb20gZmlsZVwiO1xuICByZWFkVGFiRWwub25jbGljayA9ICgpID0+IGZpbGVJbnB1dC5jbGljaygpO1xuICB0YWJzQ29udGFpbmVyLmFwcGVuZENoaWxkKHJlYWRUYWJFbCk7XG5cbiAgY29uc3Qgc2F2ZVRhYkVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgc2F2ZVRhYkVsLmNsYXNzTmFtZSA9IFwidGFiLWFkZFwiO1xuICBzYXZlVGFiRWwuaW5uZXJIVE1MID0gXCLwn5K+XCI7XG4gIHNhdmVUYWJFbC50aXRsZSA9IFwiU2F2ZSB0byBmaWxlXCI7XG4gIHNhdmVUYWJFbC5vbmNsaWNrID0gYXN5bmMgKCkgPT4ge1xuICAgIGNvbnN0IGFjdGl2ZVRhYiA9IHNlc3Npb25TdGF0ZS50YWJzLmZpbmQodCA9PiB0LmlkID09PSBzZXNzaW9uU3RhdGUuYWN0aXZlVGFiSWQpO1xuICAgIGlmIChhY3RpdmVUYWIpIHtcbiAgICAgIGF3YWl0IGRvd25sb2FkRmlsZShgJHthY3RpdmVUYWIudGl0bGV9LnN0cnVkZWxgLCBhY3RpdmVUYWIuY29udGVudCk7XG4gICAgfVxuICB9O1xuICB0YWJzQ29udGFpbmVyLmFwcGVuZENoaWxkKHNhdmVUYWJFbCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNsb3NlVGFiKHRhYjogVGFiKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChzZXNzaW9uU3RhdGUudGFicy5sZW5ndGggPD0gMSkgcmV0dXJuO1xuICBjb25zdCBzYXZlID0gY29uZmlybShgRG8geW91IHdhbnQgdG8gc2F2ZSB0aGUgc2NyaXB0IFwiJHt0YWIudGl0bGV9XCIgdG8gYSBmaWxlIGJlZm9yZSBjbG9zaW5nP2ApO1xuICBpZiAoc2F2ZSkge1xuICAgIGF3YWl0IGRvd25sb2FkRmlsZShgJHt0YWIudGl0bGV9LnN0cnVkZWxgLCB0YWIuY29udGVudCk7XG4gIH1cbiAgc2VuZCh7IHR5cGU6IFwiY2xvc2VfdGFiXCIsIGlkOiB0YWIuaWQgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkRmlsZShmaWxlbmFtZTogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gVHJ5IHVzaW5nIEZpbGUgU3lzdGVtIEFjY2VzcyBBUEkgZmlyc3QgZm9yIGEgcmVhbCBcIlNhdmUgQXNcIiBkaWFsb2dcbiAgaWYgKFwic2hvd1NhdmVGaWxlUGlja2VyXCIgaW4gd2luZG93KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhbmRsZSA9IGF3YWl0ICh3aW5kb3cgYXMgYW55KS5zaG93U2F2ZUZpbGVQaWNrZXIoe1xuICAgICAgICBzdWdnZXN0ZWROYW1lOiBmaWxlbmFtZSxcbiAgICAgICAgdHlwZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJTdHJ1ZGVsIFNjcmlwdFwiLFxuICAgICAgICAgICAgYWNjZXB0OiB7IFwidGV4dC9qYXZhc2NyaXB0XCI6IFtcIi5zdHJ1ZGVsXCIsIFwiLmpzXCIsIFwiLnR4dFwiXSB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHdyaXRhYmxlID0gYXdhaXQgaGFuZGxlLmNyZWF0ZVdyaXRhYmxlKCk7XG4gICAgICBhd2FpdCB3cml0YWJsZS53cml0ZShjb250ZW50KTtcbiAgICAgIGF3YWl0IHdyaXRhYmxlLmNsb3NlKCk7XG4gICAgICByZXR1cm47XG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgIGlmIChlcnIubmFtZSA9PT0gXCJBYm9ydEVycm9yXCIpIHJldHVybjtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJGaWxlIFN5c3RlbSBBY2Nlc3MgQVBJIGZhaWxlZCwgZmFsbGluZyBiYWNrIHRvIGRvd25sb2FkOlwiLCBlcnIpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEZhbGxiYWNrIHRvIHRyYWRpdGlvbmFsIGRvd25sb2FkXG4gIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbY29udGVudF0sIHsgdHlwZTogXCJ0ZXh0L2phdmFzY3JpcHRcIiB9KTtcbiAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJhXCIpO1xuICBhLmhyZWYgPSB1cmw7XG4gIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgYS5jbGljaygpO1xuICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG59XG5cbi8qKiBIaXN0b3J5IE1hbmFnZW1lbnQgKFVuZG8vUmVkbykgKi9cbmZ1bmN0aW9uIGdldEhpc3RvcnkodGFiSWQ6IHN0cmluZyk6IEhpc3RvcnlTdGF0ZSB7XG4gIGlmICghaGlzdG9yeVN0YWNrW3RhYklkXSkge1xuICAgIGhpc3RvcnlTdGFja1t0YWJJZF0gPSB7IHBhc3Q6IFtdLCBmdXR1cmU6IFtdIH07XG4gIH1cbiAgcmV0dXJuIGhpc3RvcnlTdGFja1t0YWJJZF07XG59XG5cbmZ1bmN0aW9uIHB1c2hIaXN0b3J5KHRhYklkOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBoID0gZ2V0SGlzdG9yeSh0YWJJZCk7XG4gIGlmIChoLnBhc3QubGVuZ3RoID4gMCAmJiBoLnBhc3RbaC5wYXN0Lmxlbmd0aCAtIDFdID09PSBjb250ZW50KSByZXR1cm47XG4gIGgucGFzdC5wdXNoKGNvbnRlbnQpO1xuICBpZiAoaC5wYXN0Lmxlbmd0aCA+IDEwMCkgaC5wYXN0LnNoaWZ0KCk7XG4gIGguZnV0dXJlID0gW107IC8vIENsZWFyIHJlZG8gc3RhY2sgb24gbmV3IGNoYW5nZVxuICB1cGRhdGVIaXN0b3J5QnV0dG9ucygpO1xufVxuXG5mdW5jdGlvbiB1bmRvKCk6IHZvaWQge1xuICBjb25zdCB0YWJJZCA9IHNlc3Npb25TdGF0ZS5hY3RpdmVUYWJJZDtcbiAgY29uc3QgaCA9IGdldEhpc3RvcnkodGFiSWQpO1xuICBpZiAoaC5wYXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIGNvbnN0IGN1cnJlbnQgPSBnZXRFZGl0b3JDb2RlKCk7XG4gIGguZnV0dXJlLnB1c2goY3VycmVudCk7XG5cbiAgY29uc3QgcHJldiA9IGgucGFzdC5wb3AoKSE7XG4gIHNldEVkaXRvckNvZGUocHJldik7XG4gIHNlbmQoeyB0eXBlOiBcInBhdHRlcm5fdXBkYXRlXCIsIGNvZGU6IHByZXYgfSk7XG4gIHVwZGF0ZUhpc3RvcnlCdXR0b25zKCk7XG59XG5cbmZ1bmN0aW9uIHJlZG8oKTogdm9pZCB7XG4gIGNvbnN0IHRhYklkID0gc2Vzc2lvblN0YXRlLmFjdGl2ZVRhYklkO1xuICBjb25zdCBoID0gZ2V0SGlzdG9yeSh0YWJJZCk7XG4gIGlmIChoLmZ1dHVyZS5sZW5ndGggPT09IDApIHJldHVybjtcblxuICBjb25zdCBjdXJyZW50ID0gZ2V0RWRpdG9yQ29kZSgpO1xuICBoLnBhc3QucHVzaChjdXJyZW50KTtcblxuICBjb25zdCBuZXh0ID0gaC5mdXR1cmUucG9wKCkhO1xuICBzZXRFZGl0b3JDb2RlKG5leHQpO1xuICBzZW5kKHsgdHlwZTogXCJwYXR0ZXJuX3VwZGF0ZVwiLCBjb2RlOiBuZXh0IH0pO1xuICB1cGRhdGVIaXN0b3J5QnV0dG9ucygpO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVIaXN0b3J5QnV0dG9ucygpOiB2b2lkIHtcbiAgY29uc3QgaCA9IGdldEhpc3Rvcnkoc2Vzc2lvblN0YXRlLmFjdGl2ZVRhYklkKTtcbiAgYnRuVW5kby5kaXNhYmxlZCA9IGgucGFzdC5sZW5ndGggPT09IDA7XG4gIGJ0blJlZG8uZGlzYWJsZWQgPSBoLmZ1dHVyZS5sZW5ndGggPT09IDA7XG4gIGJ0blVuZG8uc3R5bGUub3BhY2l0eSA9IGJ0blVuZG8uZGlzYWJsZWQgPyBcIjAuM1wiIDogXCIxXCI7XG4gIGJ0blJlZG8uc3R5bGUub3BhY2l0eSA9IGJ0blJlZG8uZGlzYWJsZWQgPyBcIjAuM1wiIDogXCIxXCI7XG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBTdHJ1ZGVsIFJFUEwgKGZhbGxiYWNrIG9ubHkg4oCUIHVzZWQgd2hlbiBTdHJ1ZGVsTWlycm9yIGlzIG5vdCBhdmFpbGFibGUpLlxuICogTXVzdCBiZSBjYWxsZWQgYWZ0ZXIgYSB1c2VyIGdlc3R1cmUgc28gdGhlIEF1ZGlvQ29udGV4dCBjYW4gYmUgY3JlYXRlZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZVN0cnVkZWwoKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChzdHJ1ZGVsUmVwbCkgcmV0dXJuO1xuICBpZiAoc3RydWRlbE1pcnJvcikgcmV0dXJuOyAvLyBTdHJ1ZGVsTWlycm9yIGhhcyBpdHMgb3duIHJlcGxcbiAgaWYgKHN0cnVkZWxJbml0UHJvbWlzZSkgcmV0dXJuIHN0cnVkZWxJbml0UHJvbWlzZTtcbiAgc3RydWRlbEluaXRQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgc3RydWRlbFJlcGwgPSBhd2FpdCBpbml0U3RydWRlbCh7XG4gICAgICAgIGVkaXRQYXR0ZXJuOiAocGF0OiB1bmtub3duKSA9PlxuICAgICAgICAgIChwYXQgYXMgeyBwaWFub3JvbGw6IChvcHRzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdW5rbm93biB9KS5waWFub3JvbGwoeyBjdHg6IGRyYXdDdHgsIGN5Y2xlczogOCwgcGxheWhlYWQ6IDAuNSB9KSxcbiAgICAgICAgcHJlYmFrZTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1pbmlNb2R1bGUgPSBhd2FpdCBpbXBvcnQoXCJAc3RydWRlbC9taW5pXCIpO1xuICAgICAgICAgIGNvbnN0IHdlYmF1ZGlvTW9kdWxlID0gYXdhaXQgaW1wb3J0KFwiQHN0cnVkZWwvd2ViYXVkaW9cIik7XG4gICAgICAgICAgY29uc3QgZHJhd01vZHVsZSA9IGF3YWl0IGltcG9ydChcIkBzdHJ1ZGVsL2RyYXdcIik7XG4gICAgICAgICAgYXdhaXQgZXZhbFNjb3BlKG1pbmlNb2R1bGUsIHdlYmF1ZGlvTW9kdWxlLCBkcmF3TW9kdWxlKTtcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5sb2coXCJbU3RydWRlbF0gSW5pdGlhbGl6ZWQgKGZhbGxiYWNrIFJFUEwpXCIpO1xuICAgICAgdXBkYXRlU3RhdHVzKFwiUmVhZHlcIik7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW1N0cnVkZWxdIEluaXQgZXJyb3I6XCIsIGVycik7XG4gICAgICB1cGRhdGVTdGF0dXMoXCJFcnJvclwiLCBcImVycm9yXCIpO1xuICAgICAgc3RydWRlbEluaXRQcm9taXNlID0gbnVsbDtcbiAgICB9XG4gIH0pKCk7XG4gIHJldHVybiBzdHJ1ZGVsSW5pdFByb21pc2U7XG59XG5cbi8qKiBFbnN1cmUgc3RydWRlbCBpcyBpbml0aWFsaXplZCwgdHJpZ2dlcmluZyBpbml0IG9uIGZpcnN0IHVzZXIgZ2VzdHVyZS4gKi9cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZVN0cnVkZWwoKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChzdHJ1ZGVsTWlycm9yKSByZXR1cm47IC8vIFN0cnVkZWxNaXJyb3IgaGFuZGxlcyBpdHMgb3duIGxpZmVjeWNsZVxuICBpZiAoIXN0cnVkZWxSZXBsKSBhd2FpdCBpbml0aWFsaXplU3RydWRlbCgpO1xufVxuXG4vKipcbiAqIENvbm5lY3QgdG8gV2ViU29ja2V0IHNlcnZlclxuICovXG5mdW5jdGlvbiBjb25uZWN0V2ViU29ja2V0KCk6IHZvaWQge1xuICBjb25zdCBwcm90b2NvbCA9IHdpbmRvdy5sb2NhdGlvbi5wcm90b2NvbCA9PT0gXCJodHRwczpcIiA/IFwid3NzOlwiIDogXCJ3czpcIjtcbiAgY29uc3Qgd3NVcmwgPSBgJHtwcm90b2NvbH0vLyR7d2luZG93LmxvY2F0aW9uLmhvc3R9L3dzYDtcblxuICB3cyA9IG5ldyBXZWJTb2NrZXQod3NVcmwpO1xuXG4gIHdzLm9ub3BlbiA9ICgpOiB2b2lkID0+IHtcbiAgICBjb25zb2xlLmxvZyhcIltXU10gQ29ubmVjdGVkXCIpO1xuICAgIHJlY29ubmVjdEF0dGVtcHRzID0gMDtcbiAgICB1cGRhdGVTdGF0dXMoXCJDb25uZWN0ZWRcIik7XG4gIH07XG5cbiAgd3Mub25jbG9zZSA9ICgpOiB2b2lkID0+IHtcbiAgICBjb25zb2xlLmxvZyhcIltXU10gRGlzY29ubmVjdGVkXCIpO1xuICAgIHVwZGF0ZVN0YXR1cyhcIkRpc2Nvbm5lY3RlZFwiLCBcImVycm9yXCIpO1xuICAgIHdzID0gbnVsbDtcblxuICAgIC8vIEF0dGVtcHQgcmVjb25uZWN0aW9uXG4gICAgaWYgKHJlY29ubmVjdEF0dGVtcHRzIDwgbWF4UmVjb25uZWN0QXR0ZW1wdHMpIHtcbiAgICAgIHJlY29ubmVjdEF0dGVtcHRzKys7XG4gICAgICBjb25zdCBkZWxheSA9IE1hdGgubWluKDEwMDAgKiAyICoqIHJlY29ubmVjdEF0dGVtcHRzLCAxMDAwMCk7XG4gICAgICBjb25zb2xlLmxvZyhgW1dTXSBSZWNvbm5lY3RpbmcgaW4gJHtkZWxheX1tcyAoYXR0ZW1wdCAke3JlY29ubmVjdEF0dGVtcHRzfSlgKTtcbiAgICAgIHNldFRpbWVvdXQoY29ubmVjdFdlYlNvY2tldCwgZGVsYXkpO1xuICAgIH1cbiAgfTtcblxuICB3cy5vbmVycm9yID0gKGVycik6IHZvaWQgPT4ge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJbV1NdIEVycm9yOlwiLCBlcnIpO1xuICB9O1xuXG4gIHdzLm9ubWVzc2FnZSA9IChldmVudCk6IHZvaWQgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gSlNPTi5wYXJzZShldmVudC5kYXRhKSBhcyBTZXJ2ZXJNZXNzYWdlO1xuICAgICAgaGFuZGxlU2VydmVyTWVzc2FnZShtZXNzYWdlKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJbV1NdIFBhcnNlIGVycm9yOlwiLCBlcnIpO1xuICAgIH1cbiAgfTtcbn1cblxuLyoqXG4gKiBIYW5kbGUgaW5jb21pbmcgc2VydmVyIG1lc3NhZ2VzXG4gKi9cbmZ1bmN0aW9uIGhhbmRsZVNlcnZlck1lc3NhZ2UobWVzc2FnZTogU2VydmVyTWVzc2FnZSk6IHZvaWQge1xuICBjb25zb2xlLmxvZyhcIltXU10gUmVjZWl2ZWQ6XCIsIG1lc3NhZ2UudHlwZSk7XG5cbiAgc3dpdGNoIChtZXNzYWdlLnR5cGUpIHtcbiAgICBjYXNlIFwic2Vzc2lvbl91cGRhdGVcIjoge1xuICAgICAgY29uc3Qgb2xkQWN0aXZlSWQgPSBzZXNzaW9uU3RhdGUuYWN0aXZlVGFiSWQ7XG4gICAgICBzZXNzaW9uU3RhdGUgPSBtZXNzYWdlLnNlc3Npb24gYXMgdW5rbm93biBhcyBTZXNzaW9uU3RhdGU7XG4gICAgICByZW5kZXJUYWJzKCk7XG4gICAgICB1cGRhdGVIaXN0b3J5QnV0dG9ucygpO1xuICAgICAgXG4gICAgICBpZiAoc2Vzc2lvblN0YXRlLmFjdGl2ZVRhYklkICE9PSBvbGRBY3RpdmVJZCkge1xuICAgICAgICBjb25zdCBhY3RpdmVUYWIgPSBzZXNzaW9uU3RhdGUudGFicy5maW5kKHQgPT4gdC5pZCA9PT0gc2Vzc2lvblN0YXRlLmFjdGl2ZVRhYklkKTtcbiAgICAgICAgaWYgKGFjdGl2ZVRhYikge1xuICAgICAgICAgIHNldEVkaXRvckNvZGUoYWN0aXZlVGFiLmNvbnRlbnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICBjYXNlIFwic3luY19zdGF0ZVwiOlxuICAgICAgLy8gU3luYyBzdGF0ZSBmcm9tIHNlcnZlclxuICAgICAgaWYgKG1lc3NhZ2UucGF0dGVybikge1xuICAgICAgICBjb25zdCBuZXdDb2RlID0gbWVzc2FnZS5wYXR0ZXJuIGFzIHN0cmluZztcbiAgICAgICAgaWYgKG5ld0NvZGUgIT09IGdldEVkaXRvckNvZGUoKSkge1xuICAgICAgICAgIHNldEVkaXRvckNvZGUobmV3Q29kZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgbWVzc2FnZS5wbGF5aW5nID09PSBcImJvb2xlYW5cIikge1xuICAgICAgICBpc1BsYXlpbmcgPSBtZXNzYWdlLnBsYXlpbmc7XG4gICAgICAgIHVwZGF0ZVBsYXlCdXR0b24oKTtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgbWVzc2FnZS5jcHMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgY29uc3QgYnBtID0gTWF0aC5yb3VuZCgobWVzc2FnZS5jcHMgKiA2MCkgLyAwLjUpO1xuICAgICAgICB0ZW1wb0lucHV0LnZhbHVlID0gU3RyaW5nKGJwbSk7XG4gICAgICB9XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgXCJzZXRfcGF0dGVyblwiOiB7XG4gICAgICBjb25zdCBuZXdDb2RlID0gbWVzc2FnZS5jb2RlIGFzIHN0cmluZztcbiAgICAgIGlmIChuZXdDb2RlICE9PSBnZXRFZGl0b3JDb2RlKCkpIHtcbiAgICAgICAgcHVzaEhpc3Rvcnkoc2Vzc2lvblN0YXRlLmFjdGl2ZVRhYklkLCBnZXRFZGl0b3JDb2RlKCkpO1xuICAgICAgICBzZXRFZGl0b3JDb2RlKG5ld0NvZGUpO1xuICAgICAgfVxuICAgICAgaWYgKG1lc3NhZ2UuYXV0b3BsYXkpIHtcbiAgICAgICAgcGxheVBhdHRlcm4oKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGNhc2UgXCJ0cmFuc3BvcnRfY29udHJvbFwiOlxuICAgICAgaWYgKG1lc3NhZ2UuYWN0aW9uID09PSBcInBsYXlcIikge1xuICAgICAgICBwbGF5UGF0dGVybigpO1xuICAgICAgfSBlbHNlIGlmIChtZXNzYWdlLmFjdGlvbiA9PT0gXCJzdG9wXCIpIHtcbiAgICAgICAgc3RvcFBhdHRlcm4oKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSBcInNldF9jcHNcIjpcbiAgICAgIGlmICh0eXBlb2YgbWVzc2FnZS5jcHMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgY29uc3QgYnBtID0gTWF0aC5yb3VuZCgobWVzc2FnZS5jcHMgKiA2MCkgLyAwLjUpO1xuICAgICAgICB0ZW1wb0lucHV0LnZhbHVlID0gU3RyaW5nKGJwbSk7XG4gICAgICAgIGlmIChzdHJ1ZGVsUmVwbCAmJiBjb250cm9scykge1xuICAgICAgICAgIGNvbnRyb2xzLnNldENwcyhtZXNzYWdlLmNwcyk7XG4gICAgICAgIH1cbiAgICAgICAgc3RydWRlbE1pcnJvcj8ucmVwbD8uc2V0Q3BzPy4obWVzc2FnZS5jcHMpO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlIFwiZXZhbHVhdGVcIjpcbiAgICAgIGV2YWx1YXRlQ29kZShtZXNzYWdlLmNvZGUgYXMgc3RyaW5nKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSBcImFnZW50X3Jlc3BvbnNlXCI6XG4gICAgY2FzZSBcImFzc2lzdGFudF9tZXNzYWdlXCI6XG4gICAgICBhZGRNZXNzYWdlKFwiYXNzaXN0YW50XCIsIG1lc3NhZ2UuY29udGVudCBhcyBzdHJpbmcpO1xuICAgICAgc2hvd1RoaW5raW5nKGZhbHNlKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSBcImFzc2lzdGFudF9jaHVua1wiOlxuICAgICAgYXBwZW5kVG9MYXN0TWVzc2FnZShtZXNzYWdlLmNvbnRlbnQgYXMgc3RyaW5nKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSBcInRvb2xfc3RhcnRcIjpcbiAgICBjYXNlIFwidG9vbF91c2VcIjpcbiAgICAgIGFkZE1lc3NhZ2UoXCJ0b29sXCIsIGBVc2luZyB0b29sOiAke21lc3NhZ2UubmFtZX1gKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSBcInRvb2xfcmVzdWx0XCI6IHtcbiAgICAgIGNvbnN0IHJlc3VsdFRleHQgPVxuICAgICAgICB0eXBlb2YgbWVzc2FnZS5vdXRwdXQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICA/IG1lc3NhZ2Uub3V0cHV0XG4gICAgICAgICAgOiB0eXBlb2YgbWVzc2FnZS5yZXN1bHQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICAgID8gbWVzc2FnZS5yZXN1bHRcbiAgICAgICAgICAgIDogSlNPTi5zdHJpbmdpZnkobWVzc2FnZS5vdXRwdXQgPz8gbWVzc2FnZS5yZXN1bHQsIG51bGwsIDIpO1xuICAgICAgYWRkTWVzc2FnZShcbiAgICAgICAgXCJ0b29sXCIsXG4gICAgICAgIGBSZXN1bHQ6ICR7cmVzdWx0VGV4dC5zbGljZSgwLCAxMDApfSR7cmVzdWx0VGV4dC5sZW5ndGggPiAxMDAgPyBcIi4uLlwiIDogXCJcIn1gXG4gICAgICApO1xuICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgY2FzZSBcImFnZW50X3RoaW5raW5nXCI6XG4gICAgY2FzZSBcInRoaW5raW5nXCI6XG4gICAgICBzaG93VGhpbmtpbmcodHJ1ZSk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgXCJkb25lXCI6XG4gICAgICBzaG93VGhpbmtpbmcoZmFsc2UpO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlIFwiZXJyb3JcIjpcbiAgICAgIGFkZE1lc3NhZ2UoXCJlcnJvclwiLCBtZXNzYWdlLm1lc3NhZ2UgYXMgc3RyaW5nKTtcbiAgICAgIHNob3dUaGlua2luZyhmYWxzZSk7XG4gICAgICBicmVhaztcblxuICAgIGRlZmF1bHQ6XG4gICAgICBjb25zb2xlLmxvZyhcIltXU10gVW5rbm93biBtZXNzYWdlIHR5cGU6XCIsIG1lc3NhZ2UudHlwZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBTZW5kIG1lc3NhZ2UgdG8gc2VydmVyXG4gKi9cbmZ1bmN0aW9uIHNlbmQobWVzc2FnZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkIHtcbiAgaWYgKHdzPy5yZWFkeVN0YXRlID09PSBXZWJTb2NrZXQuT1BFTikge1xuICAgIHdzLnNlbmQoSlNPTi5zdHJpbmdpZnkobWVzc2FnZSkpO1xuICB9IGVsc2Uge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJbV1NdIE5vdCBjb25uZWN0ZWRcIik7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2VuZENsaWVudExvZyhsZXZlbDogXCJlcnJvclwiIHwgXCJ3YXJuXCIgfCBcImluZm9cIiwgbWVzc2FnZTogc3RyaW5nLCBzdGFjaz86IHN0cmluZyk6IHZvaWQge1xuICBzZW5kKHsgdHlwZTogXCJjbGllbnRfbG9nXCIsIGxldmVsLCBtZXNzYWdlLCBzdGFjayB9KTtcbn1cblxuLyoqXG4gKiBQbGF5IHRoZSBjdXJyZW50IHBhdHRlcm5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcGxheVBhdHRlcm4oKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IGVuc3VyZVN0cnVkZWwoKTtcblxuICAvLyBQcmVmZXIgU3RydWRlbE1pcnJvciDigJQgaXQgaGFzIHRoZSBEcmF3ZXIraGlnaGxpZ2h0aW5nIGJ1aWx0IGluXG4gIGlmIChzdHJ1ZGVsTWlycm9yKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN0cnVkZWxNaXJyb3IuZXZhbHVhdGUodHJ1ZSk7XG4gICAgICBpc1BsYXlpbmcgPSB0cnVlO1xuICAgICAgdXBkYXRlUGxheUJ1dHRvbigpO1xuICAgICAgdXBkYXRlU3RhdHVzKFwiUGxheWluZ1wiLCBcInBsYXlpbmdcIik7XG4gICAgICByZXR1cm47XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBtc2cgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogU3RyaW5nKGVycik7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW1N0cnVkZWxNaXJyb3JdIEV2YWwgZXJyb3I6XCIsIGVycik7XG4gICAgICBzZW5kQ2xpZW50TG9nKFwiZXJyb3JcIiwgYEV2YWwgZXJyb3I6ICR7bXNnfWAsIGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLnN0YWNrIDogdW5kZWZpbmVkKTtcbiAgICAgIHVwZGF0ZVN0YXR1cyhcIkVycm9yXCIsIFwiZXJyb3JcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG5cbiAgLy8gRmFsbGJhY2s6IHVzZSBpbml0U3RydWRlbCBSRVBMIChubyBoaWdobGlnaHRpbmcpXG4gIGNvbnN0IGNvZGUgPSBnZXRFZGl0b3JDb2RlKCk7XG4gIGlmIChzdHJ1ZGVsUmVwbCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdHJ1ZGVsUmVwbC5ldmFsdWF0ZShjb2RlKTtcbiAgICAgIGlzUGxheWluZyA9IHRydWU7XG4gICAgICB1cGRhdGVQbGF5QnV0dG9uKCk7XG4gICAgICB1cGRhdGVTdGF0dXMoXCJQbGF5aW5nXCIsIFwicGxheWluZ1wiKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG1zZyA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiBTdHJpbmcoZXJyKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJbU3RydWRlbF0gRXZhbCBlcnJvcjpcIiwgZXJyKTtcbiAgICAgIHNlbmRDbGllbnRMb2coXCJlcnJvclwiLCBgRXZhbCBlcnJvcjogJHttc2d9YCwgZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIuc3RhY2sgOiB1bmRlZmluZWQpO1xuICAgICAgdXBkYXRlU3RhdHVzKFwiRXJyb3JcIiwgXCJlcnJvclwiKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY29uc29sZS5lcnJvcihcIltTdHJ1ZGVsXSBOb3QgaW5pdGlhbGl6ZWQsIGNhbm5vdCBwbGF5XCIpO1xuICAgIHNlbmRDbGllbnRMb2coXCJlcnJvclwiLCBcIlN0cnVkZWwgbm90IGluaXRpYWxpemVkLCBjYW5ub3QgcGxheVwiKTtcbiAgfVxufVxuXG4vKipcbiAqIFN0b3AgcGxheWJhY2tcbiAqL1xuYXN5bmMgZnVuY3Rpb24gc3RvcFBhdHRlcm4oKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChzdHJ1ZGVsTWlycm9yKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN0cnVkZWxNaXJyb3Iuc3RvcCgpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcihcIltTdHJ1ZGVsTWlycm9yXSBTdG9wIGVycm9yOlwiLCBlcnIpO1xuICAgIH1cbiAgfVxuICB0cnkgeyBodXNoKCk7IH0gY2F0Y2ggKF8pIHsgLyogaHVzaCgpIHJlcXVpcmVzIGluaXRTdHJ1ZGVsIHJlcGw7IHNhZmUgdG8gaWdub3JlICovIH1cbiAgaXNQbGF5aW5nID0gZmFsc2U7XG4gIHVwZGF0ZVBsYXlCdXR0b24oKTtcbiAgdXBkYXRlU3RhdHVzKFwiU3RvcHBlZFwiKTtcbiAgZHJhd0N0eC5jbGVhclJlY3QoMCwgMCwgdml6Q2FudmFzLndpZHRoLCB2aXpDYW52YXMuaGVpZ2h0KTtcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZSBjb2RlIHdpdGhvdXQgY2hhbmdpbmcgcGxheSBzdGF0ZVxuICovXG5hc3luYyBmdW5jdGlvbiBldmFsdWF0ZUNvZGUoY29kZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IGVuc3VyZVN0cnVkZWwoKTtcblxuICAvLyBXaGVuIHVzaW5nIFN0cnVkZWxNaXJyb3IsIHNldCB0aGUgY29kZSBpbiB0aGUgZWRpdG9yIGZpcnN0LCB0aGVuIGV2YWx1YXRlXG4gIGlmIChzdHJ1ZGVsTWlycm9yKSB7XG4gICAgc2V0RWRpdG9yQ29kZShjb2RlKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3RydWRlbE1pcnJvci5ldmFsdWF0ZShmYWxzZSk7XG4gICAgICB1cGRhdGVTdGF0dXMoXCJFdmFsdWF0ZWRcIiwgXCJwbGF5aW5nXCIpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcihcIltTdHJ1ZGVsTWlycm9yXSBFdmFsIGVycm9yOlwiLCBlcnIpO1xuICAgICAgdXBkYXRlU3RhdHVzKFwiRXJyb3JcIiwgXCJlcnJvclwiKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gRmFsbGJhY2tcbiAgaWYgKHN0cnVkZWxSZXBsKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN0cnVkZWxSZXBsLmV2YWx1YXRlKGNvZGUpO1xuICAgICAgdXBkYXRlU3RhdHVzKFwiRXZhbHVhdGVkXCIsIFwicGxheWluZ1wiKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJbU3RydWRlbF0gRXZhbCBlcnJvcjpcIiwgZXJyKTtcbiAgICAgIHVwZGF0ZVN0YXR1cyhcIkVycm9yXCIsIFwiZXJyb3JcIik7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVXBkYXRlIHBsYXkgYnV0dG9uIHN0YXRlXG4gKi9cbmZ1bmN0aW9uIHVwZGF0ZVBsYXlCdXR0b24oKTogdm9pZCB7XG4gIGlmIChpc1BsYXlpbmcpIHtcbiAgICBidG5QbGF5LmNsYXNzTGlzdC5hZGQoXCJwbGF5aW5nXCIpO1xuICAgIGJ0blBsYXkudGV4dENvbnRlbnQgPSBcIuKPuCBQYXVzZVwiO1xuICB9IGVsc2Uge1xuICAgIGJ0blBsYXkuY2xhc3NMaXN0LnJlbW92ZShcInBsYXlpbmdcIik7XG4gICAgYnRuUGxheS50ZXh0Q29udGVudCA9IFwi4pa2IFBsYXlcIjtcbiAgfVxufVxuXG4vKipcbiAqIFVwZGF0ZSBzdGF0dXMgaW5kaWNhdG9yXG4gKi9cbmZ1bmN0aW9uIHVwZGF0ZVN0YXR1cyh0ZXh0OiBzdHJpbmcsIGNsYXNzTmFtZT86IHN0cmluZyk6IHZvaWQge1xuICBzdGF0dXNJbmRpY2F0b3IudGV4dENvbnRlbnQgPSB0ZXh0O1xuICBzdGF0dXNJbmRpY2F0b3IuY2xhc3NOYW1lID0gXCJzdGF0dXNcIjtcbiAgaWYgKGNsYXNzTmFtZSkge1xuICAgIHN0YXR1c0luZGljYXRvci5jbGFzc0xpc3QuYWRkKGNsYXNzTmFtZSk7XG4gIH1cbn1cblxudHlwZSBNZXNzYWdlUm9sZSA9IFwidXNlclwiIHwgXCJhc3Npc3RhbnRcIiB8IFwidG9vbFwiIHwgXCJlcnJvclwiO1xuXG4vKipcbiAqIEFkZCBtZXNzYWdlIHRvIGNoYXRcbiAqL1xuZnVuY3Rpb24gYWRkTWVzc2FnZShyb2xlOiBNZXNzYWdlUm9sZSwgY29udGVudDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IG1lc3NhZ2VEaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBtZXNzYWdlRGl2LmNsYXNzTmFtZSA9IGBtZXNzYWdlICR7cm9sZX1gO1xuXG4gIGNvbnN0IGNvbnRlbnREaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBjb250ZW50RGl2LmNsYXNzTmFtZSA9IFwibWVzc2FnZS1jb250ZW50XCI7XG5cbiAgLy8gUGFyc2UgbWFya2Rvd24tbGlrZSBjb250ZW50IGZvciBhc3Npc3RhbnQgbWVzc2FnZXNcbiAgaWYgKHJvbGUgPT09IFwiYXNzaXN0YW50XCIpIHtcbiAgICBjb250ZW50RGl2LmlubmVySFRNTCA9IHBhcnNlU2ltcGxlTWFya2Rvd24oY29udGVudCk7XG4gIH0gZWxzZSB7XG4gICAgY29udGVudERpdi50ZXh0Q29udGVudCA9IGNvbnRlbnQ7XG4gIH1cblxuICBtZXNzYWdlRGl2LmFwcGVuZENoaWxkKGNvbnRlbnREaXYpO1xuICBjaGF0TWVzc2FnZXMuYXBwZW5kQ2hpbGQobWVzc2FnZURpdik7XG4gIGNoYXRNZXNzYWdlcy5zY3JvbGxUb3AgPSBjaGF0TWVzc2FnZXMuc2Nyb2xsSGVpZ2h0O1xufVxuXG4vKipcbiAqIEFwcGVuZCBjb250ZW50IHRvIHRoZSBsYXN0IGFzc2lzdGFudCBtZXNzYWdlIChmb3Igc3RyZWFtaW5nKVxuICovXG5mdW5jdGlvbiBhcHBlbmRUb0xhc3RNZXNzYWdlKGNvbnRlbnQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBsYXN0TWVzc2FnZSA9IGNoYXRNZXNzYWdlcy5xdWVyeVNlbGVjdG9yKFxuICAgIFwiLm1lc3NhZ2UuYXNzaXN0YW50Omxhc3QtY2hpbGQgLm1lc3NhZ2UtY29udGVudFwiXG4gICk7XG4gIGlmIChsYXN0TWVzc2FnZSkge1xuICAgIGxhc3RNZXNzYWdlLmlubmVySFRNTCA9IHBhcnNlU2ltcGxlTWFya2Rvd24oKGxhc3RNZXNzYWdlLnRleHRDb250ZW50IHx8IFwiXCIpICsgY29udGVudCk7XG4gIH0gZWxzZSB7XG4gICAgYWRkTWVzc2FnZShcImFzc2lzdGFudFwiLCBjb250ZW50KTtcbiAgfVxuICBjaGF0TWVzc2FnZXMuc2Nyb2xsVG9wID0gY2hhdE1lc3NhZ2VzLnNjcm9sbEhlaWdodDtcbn1cblxuLyoqXG4gKiBTaW1wbGUgbWFya2Rvd24gcGFyc2VyXG4gKi9cbmZ1bmN0aW9uIHBhcnNlU2ltcGxlTWFya2Rvd24odGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIChcbiAgICB0ZXh0XG4gICAgICAvLyBDb2RlIGJsb2Nrc1xuICAgICAgLnJlcGxhY2UoL2BgYChcXHcqKVxcbihbXFxzXFxTXSo/KWBgYC9nLCBcIjxwcmU+PGNvZGU+JDI8L2NvZGU+PC9wcmU+XCIpXG4gICAgICAvLyBJbmxpbmUgY29kZVxuICAgICAgLnJlcGxhY2UoL2AoW15gXSspYC9nLCBcIjxjb2RlPiQxPC9jb2RlPlwiKVxuICAgICAgLy8gQm9sZFxuICAgICAgLnJlcGxhY2UoL1xcKlxcKihbXipdKylcXCpcXCovZywgXCI8c3Ryb25nPiQxPC9zdHJvbmc+XCIpXG4gICAgICAvLyBJdGFsaWNcbiAgICAgIC5yZXBsYWNlKC9cXCooW14qXSspXFwqL2csIFwiPGVtPiQxPC9lbT5cIilcbiAgICAgIC8vIExpbmUgYnJlYWtzXG4gICAgICAucmVwbGFjZSgvXFxuL2csIFwiPGJyPlwiKVxuICApO1xufVxuXG4vKipcbiAqIFNob3cvaGlkZSB0aGlua2luZyBpbmRpY2F0b3JcbiAqL1xuZnVuY3Rpb24gc2hvd1RoaW5raW5nKHNob3c6IGJvb2xlYW4pOiB2b2lkIHtcbiAgY29uc3QgZXhpc3RpbmdJbmRpY2F0b3IgPSBjaGF0TWVzc2FnZXMucXVlcnlTZWxlY3RvcihcIi5sb2FkaW5nXCIpO1xuICBpZiAoc2hvdyAmJiAhZXhpc3RpbmdJbmRpY2F0b3IpIHtcbiAgICBjb25zdCBsb2FkaW5nRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBsb2FkaW5nRGl2LmNsYXNzTmFtZSA9IFwibG9hZGluZ1wiO1xuICAgIGxvYWRpbmdEaXYudGV4dENvbnRlbnQgPSBcIlRoaW5raW5nXCI7XG4gICAgY2hhdE1lc3NhZ2VzLmFwcGVuZENoaWxkKGxvYWRpbmdEaXYpO1xuICAgIGNoYXRNZXNzYWdlcy5zY3JvbGxUb3AgPSBjaGF0TWVzc2FnZXMuc2Nyb2xsSGVpZ2h0O1xuICB9IGVsc2UgaWYgKCFzaG93ICYmIGV4aXN0aW5nSW5kaWNhdG9yKSB7XG4gICAgZXhpc3RpbmdJbmRpY2F0b3IucmVtb3ZlKCk7XG4gIH1cbn1cblxuLy8gRXZlbnQgTGlzdGVuZXJzXG5cbi8vIFBsYXkgYnV0dG9uXG5idG5QbGF5LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gIGlmIChpc1BsYXlpbmcpIHtcbiAgICBzdG9wUGF0dGVybigpO1xuICAgIHNlbmQoeyB0eXBlOiBcInRyYW5zcG9ydFwiLCBhY3Rpb246IFwic3RvcFwiIH0pO1xuICB9IGVsc2Uge1xuICAgIHBsYXlQYXR0ZXJuKCk7XG4gICAgc2VuZCh7IHR5cGU6IFwidHJhbnNwb3J0XCIsIGFjdGlvbjogXCJwbGF5XCIgfSk7XG4gICAgc2VuZCh7IHR5cGU6IFwicGF0dGVybl91cGRhdGVcIiwgY29kZTogZ2V0RWRpdG9yQ29kZSgpIH0pO1xuICB9XG59KTtcblxuLy8gU3RvcCBidXR0b25cbmJ0blN0b3AuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgc3RvcFBhdHRlcm4oKTtcbiAgc2VuZCh7IHR5cGU6IFwidHJhbnNwb3J0XCIsIGFjdGlvbjogXCJzdG9wXCIgfSk7XG59KTtcblxuLy8gVGVtcG8gY2hhbmdlXG50ZW1wb0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xuICBjb25zdCBicG0gPSBOdW1iZXIucGFyc2VJbnQodGVtcG9JbnB1dC52YWx1ZSwgMTApO1xuICBpZiAoYnBtID49IDIwICYmIGJwbSA8PSAzMDApIHtcbiAgICBjb25zdCBjcHMgPSAoYnBtIC8gNjApICogMC41O1xuICAgIGlmIChzdHJ1ZGVsUmVwbCAmJiBjb250cm9scykge1xuICAgICAgY29udHJvbHMuc2V0Q3BzKGNwcyk7XG4gICAgfVxuICAgIHN0cnVkZWxNaXJyb3I/LnJlcGw/LnNldENwcz8uKGNwcyk7XG4gICAgLy8gRG9uJ3Qgc2VuZCB0byBzZXJ2ZXIgLSBhZ2VudCBjb250cm9scyB0ZW1wb1xuICB9XG59KTtcblxuLy8gVW5kbyBidXR0b25cbmJ0blVuZG8uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHVuZG8pO1xuXG4vLyBSZWRvIGJ1dHRvblxuYnRuUmVkby5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgcmVkbyk7XG5cbi8vIEZpbGUgaW5wdXQgZm9yIFJlYWQgZnJvbSBmaWxlXG5maWxlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoZSkgPT4ge1xuICBjb25zdCBmaWxlID0gKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLmZpbGVzPy5bMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuXG4gIGNvbnN0IGZpbGVOYW1lID0gZmlsZS5uYW1lLnJlcGxhY2UoL1xcLlteLy5dKyQvLCBcIlwiKTsgLy8gUmVtb3ZlIGV4dGVuc2lvblxuXG4gIGNvbnN0IHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKCk7XG4gIHJlYWRlci5vbmxvYWQgPSAoZXZlbnQpID0+IHtcbiAgICBjb25zdCBjb250ZW50ID0gZXZlbnQudGFyZ2V0Py5yZXN1bHQgYXMgc3RyaW5nO1xuICAgIGlmIChjb250ZW50KSB7XG4gICAgICBwdXNoSGlzdG9yeShzZXNzaW9uU3RhdGUuYWN0aXZlVGFiSWQsIGdldEVkaXRvckNvZGUoKSk7XG4gICAgICBzZXRFZGl0b3JDb2RlKGNvbnRlbnQpO1xuICAgICAgc2VuZCh7IHR5cGU6IFwicGF0dGVybl91cGRhdGVcIiwgY29kZTogY29udGVudCB9KTtcbiAgICAgIHNlbmQoeyB0eXBlOiBcInJlbmFtZV90YWJcIiwgaWQ6IHNlc3Npb25TdGF0ZS5hY3RpdmVUYWJJZCwgdGl0bGU6IGZpbGVOYW1lIH0pO1xuICAgIH1cbiAgfTtcbiAgcmVhZGVyLnJlYWRBc1RleHQoZmlsZSk7XG59KTtcblxuLy8gQ2hhdCBmb3JtXG5jaGF0Rm9ybS5hZGRFdmVudExpc3RlbmVyKFwic3VibWl0XCIsIChlKSA9PiB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgY29uc3QgbWVzc2FnZSA9IGNoYXRJbnB1dC52YWx1ZS50cmltKCk7XG4gIGlmIChtZXNzYWdlKSB7XG4gICAgLy8gQmFja3VwIGN1cnJlbnQgY29kZSBiZWZvcmUgQUkgbWlnaHQgY2hhbmdlIGl0XG4gICAgcHVzaEhpc3Rvcnkoc2Vzc2lvblN0YXRlLmFjdGl2ZVRhYklkLCBnZXRFZGl0b3JDb2RlKCkpO1xuICAgIFxuICAgIC8vIFN5bmMgY3VycmVudCBlZGl0b3IgY29udGVudCB0byBzZXJ2ZXIgYmVmb3JlIGFnZW50IHJ1bnNcbiAgICBzZW5kKHsgdHlwZTogXCJwYXR0ZXJuX3VwZGF0ZVwiLCBjb2RlOiBnZXRFZGl0b3JDb2RlKCkgfSk7XG4gICAgYWRkTWVzc2FnZShcInVzZXJcIiwgbWVzc2FnZSk7XG4gICAgc2VuZCh7IHR5cGU6IFwiY2hhdFwiLCBtZXNzYWdlIH0pO1xuICAgIGNoYXRJbnB1dC52YWx1ZSA9IFwiXCI7XG4gICAgc2hvd1RoaW5raW5nKHRydWUpO1xuICB9XG59KTtcblxuLy8gRW50ZXIgdG8gc2VuZCAoU2hpZnQrRW50ZXIgZm9yIG5ld2xpbmUpXG5jaGF0SW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGUpID0+IHtcbiAgaWYgKGUua2V5ID09PSBcIkVudGVyXCIgJiYgIWUuc2hpZnRLZXkpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgY2hhdEZvcm0uZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoXCJzdWJtaXRcIikpO1xuICB9XG59KTtcblxuLy8gS2V5Ym9hcmQgc2hvcnRjdXRzIChnbG9iYWwg4oCUIENvZGVNaXJyb3IgaGFuZGxlcyBpdHMgb3duIEN0cmwrRW50ZXIpXG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZSkgPT4ge1xuICAvLyBDdHJsL0NtZCArIC4gdG8gc3RvcFxuICBpZiAoKGUuY3RybEtleSB8fCBlLm1ldGFLZXkpICYmIGUua2V5ID09PSBcIi5cIikge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBzdG9wUGF0dGVybigpO1xuICAgIHNlbmQoeyB0eXBlOiBcInRyYW5zcG9ydFwiLCBhY3Rpb246IFwic3RvcFwiIH0pO1xuICB9XG5cbiAgLy8gQ3RybC9DbWQgKyBaIGZvciBVbmRvXG4gIGlmICgoZS5jdHJsS2V5IHx8IGUubWV0YUtleSkgJiYgZS5rZXkgPT09IFwielwiICYmICFlLnNoaWZ0S2V5KSB7XG4gICAgaWYgKGRvY3VtZW50LmFjdGl2ZUVsZW1lbnQgIT09IGNoYXRJbnB1dCkge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgdW5kbygpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEN0cmwvQ21kICsgWSBvciBDdHJsK1NoaWZ0K1ogZm9yIFJlZG9cbiAgaWYgKFxuICAgIChlLmN0cmxLZXkgfHwgZS5tZXRhS2V5KSAmJiBcbiAgICAoZS5rZXkgPT09IFwieVwiIHx8IChlLmtleSA9PT0gXCJaXCIgJiYgZS5zaGlmdEtleSkpXG4gICkge1xuICAgIGlmIChkb2N1bWVudC5hY3RpdmVFbGVtZW50ICE9PSBjaGF0SW5wdXQpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIHJlZG8oKTtcbiAgICB9XG4gIH1cbn0pO1xuXG4vLyBSZXNpemFibGUgcGFuZXNcbmxldCBpc1Jlc2l6aW5nID0gZmFsc2U7XG5yZXNpemVIYW5kbGUuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCAoKSA9PiB7XG4gIGlzUmVzaXppbmcgPSB0cnVlO1xuICByZXNpemVIYW5kbGUuY2xhc3NMaXN0LmFkZChcImRyYWdnaW5nXCIpO1xuICBkb2N1bWVudC5ib2R5LnN0eWxlLmN1cnNvciA9IFwiY29sLXJlc2l6ZVwiO1xuICBkb2N1bWVudC5ib2R5LnN0eWxlLnVzZXJTZWxlY3QgPSBcIm5vbmVcIjtcbn0pO1xuXG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIChlKSA9PiB7XG4gIGlmICghaXNSZXNpemluZykgcmV0dXJuO1xuXG4gIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIubWFpblwiKTtcbiAgaWYgKCFjb250YWluZXIpIHJldHVybjtcblxuICBjb25zdCBjb250YWluZXJXaWR0aCA9IGNvbnRhaW5lci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS53aWR0aDtcbiAgY29uc3QgbmV3V2lkdGggPSBlLmNsaWVudFg7XG4gIGNvbnN0IG1pbldpZHRoID0gMzAwO1xuICBjb25zdCBtYXhXaWR0aCA9IGNvbnRhaW5lcldpZHRoIC0gMjgwO1xuXG4gIGlmIChuZXdXaWR0aCA+PSBtaW5XaWR0aCAmJiBuZXdXaWR0aCA8PSBtYXhXaWR0aCkge1xuICAgIGVkaXRvclBhbmUuc3R5bGUuZmxleCA9IFwibm9uZVwiO1xuICAgIGVkaXRvclBhbmUuc3R5bGUud2lkdGggPSBgJHtuZXdXaWR0aH1weGA7XG4gICAgcmVzaXplVml6Q2FudmFzKCk7XG4gIH1cbn0pO1xuXG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCAoKSA9PiB7XG4gIGlmIChpc1Jlc2l6aW5nKSB7XG4gICAgaXNSZXNpemluZyA9IGZhbHNlO1xuICAgIHJlc2l6ZUhhbmRsZS5jbGFzc0xpc3QucmVtb3ZlKFwiZHJhZ2dpbmdcIik7XG4gICAgZG9jdW1lbnQuYm9keS5zdHlsZS5jdXJzb3IgPSBcIlwiO1xuICAgIGRvY3VtZW50LmJvZHkuc3R5bGUudXNlclNlbGVjdCA9IFwiXCI7XG4gIH1cbn0pO1xuXG4vLyBJbml0aWFsaXplIG9uIGxvYWRcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgZGVmYXVsdENvZGUgPSBgLy8gV2VsY29tZSB0byBBcGZlbHN0cnVkZWwhIPCfpadcbi8vIFByZXNzIFBsYXkgb3IgQ3RybCtFbnRlciwgb3IgYXNrIHRoZSBBSSFcblxuc3RhY2soXG4gIHMoXCJiZCBbfiBiZF0gc2QgW2JkIH4gXVwiKSxcbiAgcyhcIlt+IGhoXSo0XCIpLmdhaW4oLjYpLFxuICBub3RlKFwiPGMyIFtjMiBlYjJdIGYyIFtmMiBhYjJdPlwiKVxuICAgIC5zKFwic2F3dG9vdGhcIikubHBmKDYwMCkuZGVjYXkoLjE1KS5zdXN0YWluKDApLFxuICBub3RlKFwiPFtjNCBlYjQgZzRdIFtmNCBhYjQgYzVdIFtlYjQgZzQgYmI0XSBbYWI0IGM1IGViNV0+LzJcIilcbiAgICAucyhcInRyaWFuZ2xlXCIpLmdhaW4oLjM1KS5kZWxheSguMjUpLnJvb20oLjMpXG4pYDtcblxuICAvLyBXYWl0IGZvciBkeW5hbWljIGNvZGVtaXJyb3IgaW1wb3J0LCB0aGVuIHNldCB1cCBlZGl0b3JcbiAgYXdhaXQgY29kZW1pcnJvclJlYWR5O1xuXG4gIC8vIFByZS1jcmVhdGUgYSBsb3ctbGF0ZW5jeSBBdWRpb0NvbnRleHQgc28gU3RydWRlbCBkb2Vzbid0IGZhbGwgYmFjayB0b1xuICAvLyB0aGUgZGVmYXVsdCBcImJhbGFuY2VkXCIgaGludCAod2hpY2ggYWRkcyB+NTAtMTAwbXMgb2YgYnVmZmVyIGxhdGVuY3kpLlxuICBjb25zdCBjdHggPSBuZXcgQXVkaW9Db250ZXh0KHsgbGF0ZW5jeUhpbnQ6IFwiaW50ZXJhY3RpdmVcIiwgc2FtcGxlUmF0ZTogNDQxMDAgfSk7XG4gIHNldEF1ZGlvQ29udGV4dChjdHgpO1xuXG4gIGlmIChTdHJ1ZGVsTWlycm9yQ3Rvcikge1xuICAgIHRyeSB7XG4gICAgICBzdHJ1ZGVsTWlycm9yID0gbmV3IFN0cnVkZWxNaXJyb3JDdG9yKHtcbiAgICAgICAgcm9vdDogZWRpdG9yUm9vdCxcbiAgICAgICAgaW5pdGlhbENvZGU6IGRlZmF1bHRDb2RlLFxuICAgICAgICBkcmF3Q29udGV4dDogZHJhd0N0eCxcbiAgICAgICAgdHJhbnNwaWxlcixcbiAgICAgICAgZGVmYXVsdE91dHB1dDogd2ViYXVkaW9PdXRwdXQsXG4gICAgICAgIGdldFRpbWU6IGdldEF1ZGlvVGltZSxcbiAgICAgICAgZWRpdFBhdHRlcm46IChwYXQ6IHVua25vd24pID0+XG4gICAgICAgICAgKHBhdCBhcyB7IHBpYW5vcm9sbDogKG9wdHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB1bmtub3duIH0pLnBpYW5vcm9sbCh7IGN0eDogZHJhd0N0eCwgY3ljbGVzOiA4LCBwbGF5aGVhZDogMC41IH0pLFxuICAgICAgICBwcmViYWtlOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgd2ViTW9kdWxlID0gYXdhaXQgaW1wb3J0KFwiQHN0cnVkZWwvd2ViXCIpO1xuICAgICAgICAgIGNvbnN0IG1pbmlNb2R1bGUgPSBhd2FpdCBpbXBvcnQoXCJAc3RydWRlbC9taW5pXCIpO1xuICAgICAgICAgIGNvbnN0IHdlYmF1ZGlvTW9kdWxlID0gYXdhaXQgaW1wb3J0KFwiQHN0cnVkZWwvd2ViYXVkaW9cIik7XG4gICAgICAgICAgY29uc3QgZHJhd01vZHVsZSA9IGF3YWl0IGltcG9ydChcIkBzdHJ1ZGVsL2RyYXdcIik7XG4gICAgICAgICAgYXdhaXQgZXZhbFNjb3BlKHdlYk1vZHVsZSwgbWluaU1vZHVsZSwgd2ViYXVkaW9Nb2R1bGUsIGRyYXdNb2R1bGUpO1xuICAgICAgICAgIC8vIFJlZ2lzdGVyIGJ1aWx0LWluIHN5bnRoIG9zY2lsbGF0b3JzIChzYXd0b290aCwgdHJpYW5nbGUsIGV0Yy4pIGFuZCBaWkZYIHNvdW5kc1xuICAgICAgICAgIGNvbnN0IHJlZ1N5bnRoID0gKHdlYk1vZHVsZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikucmVnaXN0ZXJTeW50aFNvdW5kcyBhcyAoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWQ7XG4gICAgICAgICAgY29uc3QgcmVnWlpGWCA9ICh3ZWJNb2R1bGUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLnJlZ2lzdGVyWlpGWFNvdW5kcyBhcyAoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWQ7XG4gICAgICAgICAgcmVnU3ludGg/LigpO1xuICAgICAgICAgIHJlZ1paRlg/LigpO1xuICAgICAgICAgIGF3YWl0IGVuc3VyZVNhbXBsZXNMb2FkZWQoKTtcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBQcm90ZWN0IGFnYWluc3QgbGlicmFyeSBidWc6IFN0cnVkZWxNaXJyb3IuYWZ0ZXJFdmFsIHNldHNcbiAgICAgIC8vIHRoaXMud2lkZ2V0cyA9IG9wdGlvbnMubWV0YT8ud2lkZ2V0cyB3aGljaCBjYW4gYmUgdW5kZWZpbmVkLFxuICAgICAgLy8gdGhlbiBjYWxscyB0aGlzLndpZGdldHMuZmlsdGVyKCkg4oaSIGNyYXNoLlxuICAgICAgLy8gVXNlIGEgcHJvcGVydHkgdHJhcCBzbyAud2lkZ2V0cy8ubWluaUxvY2F0aW9ucyBhbHdheXMgcmV0dXJuIGFycmF5cy5cbiAgICAgIGNvbnN0IHNhZmVBcnJheSA9ICh0YXJnZXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBwcm9wOiBzdHJpbmcpID0+IHtcbiAgICAgICAgbGV0IHZhbHVlOiB1bmtub3duW10gPSBbXTtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgcHJvcCwge1xuICAgICAgICAgIGdldDogKCkgPT4gdmFsdWUsXG4gICAgICAgICAgc2V0OiAodjogdW5rbm93bikgPT4geyB2YWx1ZSA9IEFycmF5LmlzQXJyYXkodikgPyB2IDogW107IH0sXG4gICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgICBzYWZlQXJyYXkoc3RydWRlbE1pcnJvciwgXCJ3aWRnZXRzXCIpO1xuICAgICAgc2FmZUFycmF5KHN0cnVkZWxNaXJyb3IsIFwibWluaUxvY2F0aW9uc1wiKTtcbiAgICAgIGVkaXRvclZpZXcgPSBzdHJ1ZGVsTWlycm9yLmVkaXRvcjtcbiAgICAgIHN0cnVkZWxNaXJyb3IucmVjb25maWd1cmVFeHRlbnNpb24/LihcImlzUGF0dGVybkhpZ2hsaWdodGluZ0VuYWJsZWRcIiwgdHJ1ZSk7XG5cbiAgICAgIC8vIExpc3RlbiBmb3IgbG9jYWwgY2hhbmdlc1xuICAgICAgbGV0IHVwZGF0ZVRpbWVvdXQ6IFRpbWVyIHwgbnVsbCA9IG51bGw7XG4gICAgICBzdHJ1ZGVsTWlycm9yLm9uVXBkYXRlPy4oKGNvZGU6IHN0cmluZykgPT4ge1xuICAgICAgICBpZiAoY29kZSA9PT0gbGFzdFNldENvZGUpIHJldHVybjsgLy8gSWdub3JlIHByb2dyYW1tYXRpYyBzZXRzXG4gICAgICAgIFxuICAgICAgICBpZiAodXBkYXRlVGltZW91dCkgY2xlYXJUaW1lb3V0KHVwZGF0ZVRpbWVvdXQpO1xuICAgICAgICB1cGRhdGVUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgc2VuZCh7IHR5cGU6IFwicGF0dGVybl91cGRhdGVcIiwgY29kZSB9KTtcbiAgICAgICAgICB1cGRhdGVUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfSwgNTAwKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zb2xlLmxvZyhcIltFZGl0b3JdIFN0cnVkZWxNaXJyb3IgaW5pdGlhbGl6ZWRcIik7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW0VkaXRvcl0gU3RydWRlbE1pcnJvciBpbml0IGZhaWxlZDpcIiwgZXJyKTtcbiAgICB9XG4gIH1cblxuICAvLyBGYWxsYmFjayB0byB0ZXh0YXJlYSBpZiBDb2RlTWlycm9yIGRpZG4ndCBpbml0aWFsaXplXG4gIGlmICghZWRpdG9yVmlldykge1xuICAgIGNvbnNvbGUud2FybihcIltFZGl0b3JdIFVzaW5nIHRleHRhcmVhIGZhbGxiYWNrXCIpO1xuICAgIGNvbnN0IGZhbGxiYWNrID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInRleHRhcmVhXCIpO1xuICAgIGZhbGxiYWNrLmlkID0gXCJjb2RlLWVkaXRvci1mYWxsYmFja1wiO1xuICAgIGZhbGxiYWNrLnZhbHVlID0gZGVmYXVsdENvZGU7XG4gICAgZmFsbGJhY2suc3R5bGUuY3NzVGV4dCA9IFwid2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtiYWNrZ3JvdW5kOnZhcigtLWJnLXByaW1hcnkpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6dmFyKC0tZm9udC1tb25vKTtmb250LXNpemU6MC45Mzc1cmVtO2JvcmRlcjpub25lO3BhZGRpbmc6MC41cmVtO3Jlc2l6ZTpub25lO1wiO1xuICAgIGVkaXRvclJvb3QuYXBwZW5kQ2hpbGQoZmFsbGJhY2spO1xuICB9XG5cbiAgY29ubmVjdFdlYlNvY2tldCgpO1xuXG4gIC8vIERlZmVyIHN0cnVkZWwgaW5pdCB0byBmaXJzdCB1c2VyIGludGVyYWN0aW9uIChBdWRpb0NvbnRleHQgcmVxdWlyZXMgZ2VzdHVyZSlcbiAgY29uc3QgaW5pdE9uR2VzdHVyZSA9IGFzeW5jICgpID0+IHtcbiAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgaW5pdE9uR2VzdHVyZSk7XG4gICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgaW5pdE9uR2VzdHVyZSk7XG5cbiAgICBjb25zdCBhdWRpb0N0eCA9IGdldEF1ZGlvQ29udGV4dCgpO1xuICAgIGlmIChhdWRpb0N0eC5zdGF0ZSA9PT0gXCJzdXNwZW5kZWRcIikge1xuICAgICAgYXVkaW9DdHgucmVzdW1lKCkuY2F0Y2goKGVycikgPT4gY29uc29sZS53YXJuKFwiW0F1ZGlvXSBSZXN1bWUgZmFpbGVkXCIsIGVycikpO1xuICAgIH1cblxuICAgIC8vIExvYWQgQXVkaW9Xb3JrbGV0cyArIHNhbXBsZXMgKHByZWJha2UgYWxyZWFkeSByYW4gZXZhbFNjb3BlICYgcmVnaXN0ZXJlZCBzeW50aHMpXG4gICAgYXdhaXQgaW5pdEF1ZGlvKCk7XG4gICAgYXdhaXQgZW5zdXJlU2FtcGxlc0xvYWRlZCgpO1xuXG4gICAgaWYgKCFzdHJ1ZGVsTWlycm9yKSB7XG4gICAgICAvLyBGYWxsYmFjazogaW5pdCBmdWxsIFJFUExcbiAgICAgIGF3YWl0IGluaXRpYWxpemVTdHJ1ZGVsKCk7XG4gICAgfVxuXG4gICAgdXBkYXRlU3RhdHVzKFwiUmVhZHlcIik7XG4gIH07XG4gIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyZG93blwiLCBpbml0T25HZXN0dXJlKTtcbiAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgaW5pdE9uR2VzdHVyZSk7XG59KTtcblxuLy8gRm9yd2FyZCBicm93c2VyIGVycm9ycyB0byB0aGUgc2VydmVyIGZvciBkZWJ1Z2dpbmdcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgKGV2ZW50KSA9PiB7XG4gIGNvbnN0IG1lc3NhZ2UgPSBldmVudC5tZXNzYWdlID8/IFwiVW5rbm93biBlcnJvclwiO1xuICBjb25zdCBzdGFjayA9IGV2ZW50LmVycm9yPy5zdGFjayA/PyBTdHJpbmcoZXZlbnQuZXJyb3IgPz8gXCJcIik7XG4gIHNlbmRDbGllbnRMb2coXCJlcnJvclwiLCBtZXNzYWdlLCBzdGFjayk7XG59KTtcblxud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJ1bmhhbmRsZWRyZWplY3Rpb25cIiwgKGV2ZW50KSA9PiB7XG4gIGNvbnN0IHJlYXNvbiA9IGV2ZW50LnJlYXNvbiA/PyBcIlVuaGFuZGxlZCByZWplY3Rpb25cIjtcbiAgY29uc3QgbWVzc2FnZSA9IHR5cGVvZiByZWFzb24gPT09IFwic3RyaW5nXCIgPyByZWFzb24gOiBKU09OLnN0cmluZ2lmeShyZWFzb24pO1xuICBzZW5kQ2xpZW50TG9nKFwiZXJyb3JcIiwgbWVzc2FnZSk7XG59KTtcbiIKICBdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7OztBQVVBO0FBQ0E7QUFLQSxJQUFJLG9CQUF5QjtBQUM3QixJQUFNLFVBQVU7QUFDaEIsSUFBTSxrQkFBNEMsZ0JBQy9DLEtBQUssQ0FBQyxRQUFRO0FBQUEsRUFDYixvQkFBb0IsSUFBSTtBQUFBLEVBQ3hCLFFBQVEsSUFBSSxxQ0FBcUM7QUFBQSxDQUNsRCxFQUNBLE1BQU0sQ0FBQyxRQUFRO0FBQUEsRUFDZCxRQUFRLE1BQU0sZ0RBQWdELEdBQUc7QUFBQSxDQUNsRTtBQTRCSCxJQUFNLGFBQWEsU0FBUyxlQUFlLGFBQWE7QUFDeEQsSUFBTSxnQkFBZ0IsU0FBUyxlQUFlLGdCQUFnQjtBQUM5RCxJQUFNLFlBQVksU0FBUyxlQUFlLFlBQVk7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
