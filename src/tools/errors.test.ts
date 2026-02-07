import { describe, it, expect, beforeEach } from "bun:test";
import { setAppState, pushEvalError, clearEvalErrors, getRecentEvalErrors } from "./shared.ts";
import type { AppState } from "./shared.ts";
import { getErrorsTool } from "./errors.ts";

function createMockState(overrides?: Partial<AppState>): AppState {
  return {
    currentPattern: 's("bd sd")',
    isPlaying: false,
    cps: 0.5,
    evalErrors: [],
    broadcast: () => {},
    ...overrides,
  };
}

describe("pushEvalError", () => {
  beforeEach(() => {
    setAppState(createMockState());
  });

  it("adds an error to state", () => {
    pushEvalError("ReferenceError: x is not defined");
    const state = createMockState();
    setAppState(state);
    pushEvalError("test error");
    expect(state.evalErrors).toHaveLength(1);
    expect(state.evalErrors[0].message).toBe("test error");
  });

  it("keeps at most 10 errors", () => {
    const state = createMockState();
    setAppState(state);
    for (let i = 0; i < 15; i++) {
      pushEvalError(`error ${i}`);
    }
    expect(state.evalErrors).toHaveLength(10);
    // newest first
    expect(state.evalErrors[0].message).toBe("error 14");
  });
});

describe("clearEvalErrors", () => {
  it("removes all errors", () => {
    const state = createMockState();
    setAppState(state);
    pushEvalError("err1");
    pushEvalError("err2");
    clearEvalErrors();
    expect(state.evalErrors).toHaveLength(0);
  });
});

describe("getRecentEvalErrors", () => {
  it("returns errors within time window", () => {
    const state = createMockState();
    setAppState(state);
    pushEvalError("recent error");
    const recent = getRecentEvalErrors(5000);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toBe("recent error");
  });

  it("excludes old errors", () => {
    const state = createMockState();
    state.evalErrors = [{ message: "old", timestamp: Date.now() - 30000 }];
    setAppState(state);
    const recent = getRecentEvalErrors(5000);
    expect(recent).toHaveLength(0);
  });
});

describe("getErrorsTool", () => {
  beforeEach(() => {
    setAppState(createMockState());
  });

  it("returns no errors message when clean", async () => {
    const result = await getErrorsTool({});
    expect(result.output).toContain("No errors");
    expect(result.error).toBeUndefined();
  });

  it("returns errors and clears them", async () => {
    const state = createMockState();
    setAppState(state);
    pushEvalError("SyntaxError: unexpected token");
    pushEvalError("ReferenceError: x is not defined");

    const result = await getErrorsTool({});
    expect(result.output).toContain("2 error(s)");
    expect(result.output).toContain("SyntaxError");
    expect(result.output).toContain("ReferenceError");
    expect(result.error).toBe(true);

    // Errors should be cleared after reading
    expect(state.evalErrors).toHaveLength(0);
  });
});
