import { describe, it, expect } from "bun:test";
import { toolHandlers, toolDefinitions } from "./index.ts";

describe("tools/index registry", () => {
  it("has matching handlers for all definitions", () => {
    for (const def of toolDefinitions) {
      expect(toolHandlers[def.name]).toBeDefined();
      expect(typeof toolHandlers[def.name]).toBe("function");
    }
  });

  it("has no orphan handlers (every handler has a definition)", () => {
    const definedNames = new Set(toolDefinitions.map((d) => d.name));
    for (const name of Object.keys(toolHandlers)) {
      expect(definedNames.has(name)).toBe(true);
    }
  });

  it("has expected number of tools", () => {
    expect(toolDefinitions.length).toBe(12);
    expect(Object.keys(toolHandlers).length).toBe(12);
  });

  it("all definitions have required fields", () => {
    for (const def of toolDefinitions) {
      expect(typeof def.name).toBe("string");
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.parameters).toBeDefined();
      expect(def.parameters.type).toBe("object");
    }
  });

  it("has unique tool names", () => {
    const names = toolDefinitions.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
