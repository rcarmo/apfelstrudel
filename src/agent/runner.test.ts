import { describe, it, expect } from "bun:test";
import { runAgent } from "./runner.ts";
import { buildClient } from "./llm.ts";
import { setAppState } from "../tools/shared.ts";
import type { ServerMessage, LLMClient, Message, ToolCallDescriptor, ToolDefinition } from "../shared/types.ts";

/** Helper to create a mock LLM client with scripted responses */
function createMockClient(
  responses: Array<{ content: string | null; toolCalls?: ToolCallDescriptor[] }>
): LLMClient {
  let callIndex = 0;
  return {
    async generate(_messages: Message[], _tools?: ToolDefinition[]) {
      const resp = responses[callIndex] ?? { content: null };
      callIndex++;
      return resp;
    },
  };
}

/**
 * Inject a mock client into runAgent by temporarily patching buildClient.
 * We use Bun's module mock to override the import.
 */
import { mock, spyOn } from "bun:test";
import * as llmModule from "./llm.ts";

describe("runAgent", () => {
  it("runs with echo provider and returns response", async () => {
    const broadcasted: ServerMessage[] = [];
    const result = await runAgent("Hello agent", {
      provider: "echo",
      model: "any",
      maxSteps: 4,
      broadcast: (msg) => broadcasted.push(msg),
      getState: () => ({ pattern: 's("bd")', playing: false, cps: 0.5 }),
    });

    expect(result).toContain("Echo:");
    expect(result).toContain("Hello agent");
    expect(broadcasted.some((m) => m.type === "agent_thinking")).toBe(true);
    expect(broadcasted.some((m) => m.type === "agent_response")).toBe(true);
  });

  it("broadcasts agent_thinking on start", async () => {
    const broadcasted: ServerMessage[] = [];
    await runAgent("Test", {
      provider: "echo",
      broadcast: (msg) => broadcasted.push(msg),
      getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
    });

    const thinking = broadcasted.find((m) => m.type === "agent_thinking");
    expect(thinking).toBeDefined();
    if (thinking && thinking.type === "agent_thinking") {
      expect(thinking.content).toBe("Thinking...");
    }
  });

  it("uses default options when not provided", async () => {
    const broadcasted: ServerMessage[] = [];
    const result = await runAgent("Test defaults", {
      provider: "echo",
      broadcast: (msg) => broadcasted.push(msg),
      getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
    });

    expect(result).toContain("Echo:");
    expect(result).toContain("Test defaults");
  });

  it("handles LLM errors gracefully", async () => {
    const broadcasted: ServerMessage[] = [];

    try {
      await runAgent("Hello", {
        provider: "openai",
        broadcast: (msg) => broadcasted.push(msg),
        getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("OPENAI_API_KEY");
    }
  });

  it("handles timeout option", async () => {
    const broadcasted: ServerMessage[] = [];
    const result = await runAgent("quick", {
      provider: "echo",
      requestTimeoutMs: 5000,
      broadcast: (msg) => broadcasted.push(msg),
      getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
    });
    expect(result).toContain("Echo:");
    expect(result).toContain("quick");
  });

  it("executes tool calls and continues loop", async () => {
    const broadcasted: ServerMessage[] = [];

    // Set up app state for the tool to read
    setAppState({
      currentPattern: 's("bd sd")',
      isPlaying: false,
      cps: 0.5,
      evalErrors: [],
      broadcast: (msg: unknown) => broadcasted.push(msg as ServerMessage),
    });

    const mockClient = createMockClient([
      // First response: call get_pattern tool
      {
        content: null,
        toolCalls: [
          { id: "call_1", name: "get_pattern", arguments: {} },
        ],
      },
      // Second response: final text after tool result
      { content: "The pattern is s(\"bd sd\")" },
    ]);

    const spy = spyOn(llmModule, "buildClient").mockReturnValue(mockClient);
    try {
      const result = await runAgent("What is the pattern?", {
        provider: "echo",
        maxSteps: 4,
        broadcast: (msg) => broadcasted.push(msg),
        getState: () => ({ pattern: 's("bd sd")', playing: false, cps: 0.5 }),
      });

      expect(result).toBe('The pattern is s("bd sd")');
      expect(broadcasted.some((m) => m.type === "tool_start")).toBe(true);
      expect(broadcasted.some((m) => m.type === "tool_result")).toBe(true);
      expect(broadcasted.some((m) => m.type === "agent_response")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("handles unknown tool names", async () => {
    const broadcasted: ServerMessage[] = [];

    setAppState({
      currentPattern: "",
      isPlaying: false,
      cps: 0.5,
      evalErrors: [],
      broadcast: (msg: unknown) => broadcasted.push(msg as ServerMessage),
    });

    const mockClient = createMockClient([
      {
        content: null,
        toolCalls: [
          { id: "call_1", name: "nonexistent_tool", arguments: {} },
        ],
      },
      { content: "Done" },
    ]);

    const spy = spyOn(llmModule, "buildClient").mockReturnValue(mockClient);
    try {
      const result = await runAgent("test", {
        provider: "echo",
        maxSteps: 4,
        broadcast: (msg) => broadcasted.push(msg),
        getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
      });

      expect(result).toBe("Done");
      const toolResult = broadcasted.find(
        (m) => m.type === "tool_result" && "error" in m && m.error === true
      );
      expect(toolResult).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("handles tool handler errors", async () => {
    const broadcasted: ServerMessage[] = [];

    setAppState({
      currentPattern: "",
      isPlaying: false,
      cps: 0.5,
      evalErrors: [],
      broadcast: () => {
        throw new Error("broadcast boom");
      },
    });

    // The tool will call getAppState().broadcast which throws
    const mockClient = createMockClient([
      {
        content: null,
        toolCalls: [
          { id: "call_1", name: "play_music", arguments: {} },
        ],
      },
      { content: "Recovered" },
    ]);

    const spy = spyOn(llmModule, "buildClient").mockReturnValue(mockClient);
    try {
      const result = await runAgent("play", {
        provider: "echo",
        maxSteps: 4,
        broadcast: (msg) => broadcasted.push(msg),
        getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
      });

      expect(result).toBe("Recovered");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns max steps message when limit reached", async () => {
    const broadcasted: ServerMessage[] = [];

    setAppState({
      currentPattern: "",
      isPlaying: false,
      cps: 0.5,
      evalErrors: [],
      broadcast: (msg: unknown) => broadcasted.push(msg as ServerMessage),
    });

    // Client always returns null content, no tool calls — hits max steps
    const mockClient = createMockClient([
      { content: null },
      { content: null },
    ]);

    const spy = spyOn(llmModule, "buildClient").mockReturnValue(mockClient);
    try {
      const result = await runAgent("test", {
        provider: "echo",
        maxSteps: 2,
        broadcast: (msg) => broadcasted.push(msg),
        getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
      });

      expect(result).toContain("maximum number of steps");
    } finally {
      spy.mockRestore();
    }
  });

  it("handles generate errors within the loop", async () => {
    const broadcasted: ServerMessage[] = [];

    setAppState({
      currentPattern: "",
      isPlaying: false,
      cps: 0.5,
      evalErrors: [],
      broadcast: (msg: unknown) => broadcasted.push(msg as ServerMessage),
    });

    // Client that throws on generate
    const failingClient: LLMClient = {
      async generate() {
        throw new Error("API failure");
      },
    };

    const spy = spyOn(llmModule, "buildClient").mockReturnValue(failingClient);
    try {
      const result = await runAgent("test", {
        provider: "echo",
        maxSteps: 2,
        broadcast: (msg) => broadcasted.push(msg),
        getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
      });

      expect(result).toContain("Error: API failure");
      const errorMsg = broadcasted.find((m) => m.type === "error");
      expect(errorMsg).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("handles non-Error thrown from generate", async () => {
    const broadcasted: ServerMessage[] = [];

    setAppState({
      currentPattern: "",
      isPlaying: false,
      cps: 0.5,
      evalErrors: [],
      broadcast: (msg: unknown) => broadcasted.push(msg as ServerMessage),
    });

    const failingClient: LLMClient = {
      async generate() {
        throw "string error";
      },
    };

    const spy = spyOn(llmModule, "buildClient").mockReturnValue(failingClient);
    try {
      const result = await runAgent("test", {
        provider: "echo",
        maxSteps: 2,
        broadcast: (msg) => broadcasted.push(msg),
        getState: () => ({ pattern: "", playing: false, cps: 0.5 }),
      });

      expect(result).toContain("Error: string error");
    } finally {
      spy.mockRestore();
    }
  });
});
