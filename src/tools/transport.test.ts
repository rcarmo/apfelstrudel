import { describe, it, expect, beforeEach } from "bun:test";
import { setAppState } from "./shared.ts";
import type { AppState } from "./shared.ts";
import { playMusicTool, stopMusicTool, strudelEvaluateTool } from "./transport.ts";

function createMockState(overrides?: Partial<AppState>): AppState {
  const messages: unknown[] = [];
  return {
    currentPattern: 's("bd sd")',
    isPlaying: false,
    cps: 0.5,
    evalErrors: [],
    broadcast: (msg: unknown) => messages.push(msg),
    ...overrides,
  };
}

describe("playMusicTool", () => {
  let broadcasted: unknown[];
  let state: AppState;

  beforeEach(() => {
    broadcasted = [];
    state = createMockState({
      broadcast: (msg: unknown) => broadcasted.push(msg),
    });
    setAppState(state);
  });

  it("starts playback and broadcasts", async () => {
    const result = await playMusicTool({});
    expect(result.output).toBe("Playback started");
    expect(state.isPlaying).toBe(true);
    expect(broadcasted[0]).toEqual({
      type: "transport_control",
      action: "play",
    });
  });
});

describe("stopMusicTool", () => {
  let broadcasted: unknown[];
  let state: AppState;

  beforeEach(() => {
    broadcasted = [];
    state = createMockState({
      isPlaying: true,
      broadcast: (msg: unknown) => broadcasted.push(msg),
    });
    setAppState(state);
  });

  it("stops playback and broadcasts", async () => {
    const result = await stopMusicTool({});
    expect(result.output).toBe("Playback stopped");
    expect(state.isPlaying).toBe(false);
    expect(broadcasted[0]).toEqual({
      type: "transport_control",
      action: "stop",
    });
  });
});

describe("strudelEvaluateTool", () => {
  let broadcasted: unknown[];
  let state: AppState;

  beforeEach(() => {
    broadcasted = [];
    state = createMockState({
      currentPattern: 's("bd sd hh cp")',
      broadcast: (msg: unknown) => broadcasted.push(msg),
    });
    setAppState(state);
  });

  it("evaluates and sets playing to true", async () => {
    const result = await strudelEvaluateTool({});
    expect(result.output).toContain("Evaluating pattern:");
    expect(result.output).toContain('s("bd sd hh cp")');
    expect(state.isPlaying).toBe(true);
    expect(broadcasted[0]).toEqual({
      type: "transport_control",
      action: "play",
    });
  });

  it("truncates long patterns in output", async () => {
    state.currentPattern = "x".repeat(200);
    setAppState(state);
    const result = await strudelEvaluateTool({});
    expect(result.output).toContain("...");
    // The output should contain at most 100 chars of the pattern
    expect(result.output.length).toBeLessThan(200);
  });
});
