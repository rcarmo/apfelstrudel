import type { ToolResult } from "../shared/types.ts";

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Shared state for tools that need to communicate with the frontend
 */
export interface AppState {
  currentPattern: string;
  isPlaying: boolean;
  cps: number;
  broadcast: (message: unknown) => void;
  /** Recent eval errors reported by the client (newest first, max 10) */
  evalErrors: { message: string; timestamp: number }[];
}

let appState: AppState | null = null;

export function setAppState(state: AppState): void {
  appState = state;
}

export function getAppState(): AppState {
  if (!appState) {
    throw new Error("App state not initialized");
  }
  return appState;
}

/** Push an eval error into state, keeping at most 10. */
export function pushEvalError(message: string): void {
  const state = getAppState();
  state.evalErrors.unshift({ message, timestamp: Date.now() });
  if (state.evalErrors.length > 10) state.evalErrors.length = 10;
}

/** Clear eval errors (called after agent reads them). */
export function clearEvalErrors(): void {
  const state = getAppState();
  state.evalErrors.length = 0;
}

/** Get recent eval errors (within last N ms, default 10s). */
export function getRecentEvalErrors(withinMs = 10000): string[] {
  const state = getAppState();
  const cutoff = Date.now() - withinMs;
  return state.evalErrors
    .filter((e) => e.timestamp >= cutoff)
    .map((e) => e.message);
}

/**
 * Truncate output to a maximum number of bytes
 */
export function truncateOutput(body: string, maxBytes: number): string {
  if (Buffer.byteLength(body, "utf8") <= maxBytes) {
    return body;
  }
  let truncated = body;
  while (Buffer.byteLength(truncated, "utf8") > maxBytes - 20) {
    truncated = truncated.slice(0, -100);
  }
  return `${truncated}\n[truncated]`;
}

/**
 * Read environment variable as integer with fallback
 */
export function envInt(name: string, fallback: number): number {
  const val = process.env[name];
  if (!val) return fallback;
  const parsed = Number.parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
