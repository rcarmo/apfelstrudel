import { describe, it, expect, beforeEach } from "bun:test";
import { setAppState } from "./shared.ts";
import type { AppState } from "./shared.ts";
import { setTempoTool } from "./tempo.ts";

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

describe("setTempoTool", () => {
  let broadcasted: unknown[];
  let state: AppState;

  beforeEach(() => {
    broadcasted = [];
    state = createMockState({
      broadcast: (msg: unknown) => broadcasted.push(msg),
    });
    setAppState(state);
  });

  it("sets valid tempo", async () => {
    const result = await setTempoTool({ cps: 1.0 });
    expect(result.output).toContain("Tempo set to 1 cps");
    expect(result.output).toContain("~240 BPM");
    expect(state.cps).toBe(1.0);
    expect(broadcasted[0]).toEqual({ type: "set_cps", cps: 1.0 });
  });

  it("rejects cps below minimum", async () => {
    const result = await setTempoTool({ cps: 0.01 });
    expect(result.error).toBe(true);
    expect(result.output).toContain("should be between 0.05 and 4.0");
  });

  it("rejects cps above maximum", async () => {
    const result = await setTempoTool({ cps: 5.0 });
    expect(result.error).toBe(true);
    expect(result.output).toContain("should be between 0.05 and 4.0");
  });

  it("accepts boundary values", async () => {
    const resultLow = await setTempoTool({ cps: 0.05 });
    expect(resultLow.error).toBeUndefined();
    expect(resultLow.output).toContain("Tempo set to 0.05 cps");

    const resultHigh = await setTempoTool({ cps: 4.0 });
    expect(resultHigh.error).toBeUndefined();
    expect(resultHigh.output).toContain("Tempo set to 4 cps");
  });

  it("calculates BPM correctly", async () => {
    // 0.5 cps * 60 * 4 = 120 BPM
    const result = await setTempoTool({ cps: 0.5 });
    expect(result.output).toContain("~120 BPM");
  });
});
