import { describe, it, expect, beforeEach } from "bun:test";
import { setAppState } from "./shared.ts";
import type { AppState } from "./shared.ts";
import { getPatternTool, setPatternTool, modifyPatternTool } from "./pattern.ts";

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

describe("getPatternTool", () => {
  beforeEach(() => {
    setAppState(createMockState());
  });

  it("returns current pattern", async () => {
    const result = await getPatternTool({});
    expect(result.output).toBe('s("bd sd")');
    expect(result.id).toBe("get_pattern");
  });

  it("returns placeholder for empty pattern", async () => {
    setAppState(createMockState({ currentPattern: "" }));
    const result = await getPatternTool({});
    expect(result.output).toBe("(empty pattern)");
  });
});

describe("setPatternTool", () => {
  let broadcasted: unknown[];

  beforeEach(() => {
    broadcasted = [];
    setAppState(
      createMockState({
        broadcast: (msg: unknown) => broadcasted.push(msg),
      })
    );
  });

  it("sets pattern and broadcasts with autoplay true by default", async () => {
    const result = await setPatternTool({ code: 's("hh*4")' });
    expect(result.output).toContain("and playing");
    expect(result.output).toContain('s("hh*4")');
    expect(broadcasted).toHaveLength(1);
    expect(broadcasted[0]).toEqual({
      type: "set_pattern",
      code: 's("hh*4")',
      autoplay: true,
    });
  });

  it("sets pattern without autoplay when autoplay is false", async () => {
    const result = await setPatternTool({ code: 's("cp")', autoplay: false });
    expect(result.output).not.toContain("and playing");
    expect(broadcasted[0]).toEqual({
      type: "set_pattern",
      code: 's("cp")',
      autoplay: false,
    });
  });

  it("updates currentPattern in state", async () => {
    const state = createMockState();
    setAppState(state);
    await setPatternTool({ code: "note('c4')" });
    expect(state.currentPattern).toBe("note('c4')");
  });
});

describe("modifyPatternTool", () => {
  let broadcasted: unknown[];

  beforeEach(() => {
    broadcasted = [];
    setAppState(
      createMockState({
        currentPattern: 's("bd sd")',
        broadcast: (msg: unknown) => broadcasted.push(msg),
      })
    );
  });

  it("modifies pattern and broadcasts", async () => {
    const result = await modifyPatternTool({
      transformation: "add_effect",
      details: "reverb",
      newCode: 's("bd sd").room(0.5)',
    });
    expect(result.output).toContain("add_effect");
    expect(result.output).toContain("reverb");
    expect(result.output).toContain('Before: s("bd sd")');
    expect(result.output).toContain('After: s("bd sd").room(0.5)');
    expect(broadcasted[0]).toEqual({
      type: "set_pattern",
      code: 's("bd sd").room(0.5)',
      autoplay: true,
    });
  });

  it("works without details", async () => {
    const result = await modifyPatternTool({
      transformation: "custom",
      newCode: 's("hh*8")',
    });
    expect(result.output).toContain("Applied custom:");
    // No details parenthetical in the "Applied custom:" prefix
    expect(result.output).toMatch(/^Applied custom:\n/);
  });
});
