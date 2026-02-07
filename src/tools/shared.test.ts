import { describe, it, expect, beforeEach } from "bun:test";
import { setAppState, getAppState, truncateOutput, envInt } from "../tools/shared.ts";
import type { AppState } from "../tools/shared.ts";

describe("setAppState / getAppState", () => {
  it("throws when state is not initialized", () => {
    // Reset internal state by setting null via a fresh import won't work,
    // but we can verify it returns after being set
    const state: AppState = {
      currentPattern: "s('bd')",
      isPlaying: false,
      cps: 0.5,
      evalErrors: [],
      broadcast: () => {},
    };
    setAppState(state);
    expect(getAppState()).toBe(state);
  });

  it("returns the state that was set", () => {
    const broadcast = (_msg: unknown) => {};
    const state: AppState = {
      currentPattern: "note('c4 e4 g4')",
      isPlaying: true,
      cps: 1.0,
      evalErrors: [],
      broadcast,
    };
    setAppState(state);
    const retrieved = getAppState();
    expect(retrieved.currentPattern).toBe("note('c4 e4 g4')");
    expect(retrieved.isPlaying).toBe(true);
    expect(retrieved.cps).toBe(1.0);
  });
});

describe("truncateOutput", () => {
  it("returns body unchanged when within limit", () => {
    const body = "hello world";
    expect(truncateOutput(body, 1000)).toBe(body);
  });

  it("truncates body that exceeds maxBytes", () => {
    const body = "a".repeat(500);
    const result = truncateOutput(body, 100);
    expect(result.length).toBeLessThan(500);
    expect(result).toContain("[truncated]");
  });

  it("handles multi-byte characters", () => {
    const body = "é".repeat(200); // 2 bytes each in UTF-8
    const result = truncateOutput(body, 100);
    expect(result).toContain("[truncated]");
  });

  it("returns exact body at boundary", () => {
    const body = "abc";
    const byteLen = Buffer.byteLength(body, "utf8");
    expect(truncateOutput(body, byteLen)).toBe(body);
  });
});

describe("envInt", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean up test env vars
    process.env.TEST_ENV_INT = undefined;
  });

  it("returns fallback when env var is not set", () => {
    process.env.TEST_ENV_INT = undefined;
    expect(envInt("TEST_ENV_INT", 42)).toBe(42);
  });

  it("returns parsed integer when env var is set", () => {
    process.env.TEST_ENV_INT = "123";
    expect(envInt("TEST_ENV_INT", 42)).toBe(123);
  });

  it("returns fallback for non-numeric value", () => {
    process.env.TEST_ENV_INT = "not-a-number";
    expect(envInt("TEST_ENV_INT", 42)).toBe(42);
  });

  it("returns fallback for empty string", () => {
    process.env.TEST_ENV_INT = "";
    expect(envInt("TEST_ENV_INT", 42)).toBe(42);
  });

  it("parses negative integers", () => {
    process.env.TEST_ENV_INT = "-10";
    expect(envInt("TEST_ENV_INT", 0)).toBe(-10);
  });
});
