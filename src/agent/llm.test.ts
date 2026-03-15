import { describe, it, expect, beforeEach } from "bun:test";
import { buildClient } from "./llm.ts";

describe("buildClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean up env vars that might interfere
    process.env.OPENAI_API_KEY = undefined;
    process.env.OPENAI_BASE_URL = undefined;
    process.env.AZURE_OPENAI_ENDPOINT = undefined;
    process.env.AZURE_OPENAI_API_KEY = undefined;
    process.env.AZURE_OPENAI_DEPLOYMENT = undefined;
    process.env.AZURE_OPENAI_API_VERSION = undefined;
    process.env.APFELSTRUDEL_LMSTUDIO_HOST = undefined;
  });

  it("returns echo client for echo provider", () => {
    const client = buildClient("echo", "any-model");
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe("function");
  });

  it("echo client echoes user message", async () => {
    const client = buildClient("echo", "any");
    const result = await client.generate([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello world" },
    ]);
    expect(result.content).toBe("Echo: Hello world");
  });

  it("echo client handles no user messages", async () => {
    const client = buildClient("echo", "any");
    const result = await client.generate([{ role: "system", content: "System" }]);
    expect(result.content).toBe("Echo");
  });

  it("echo client finds last user message", async () => {
    const client = buildClient("echo", "any");
    const result = await client.generate([
      { role: "user", content: "First" },
      { role: "assistant", content: "Response" },
      { role: "user", content: "Second" },
    ]);
    expect(result.content).toBe("Echo: Second");
  });

  it("throws for openai without API key", () => {
    expect(() => buildClient("openai", "gpt-4")).toThrow("OPENAI_API_KEY");
  });

  it("creates openai client with API key", () => {
    process.env.OPENAI_API_KEY = "test-key";
    const client = buildClient("openai", "gpt-4");
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe("function");
  });

  it("throws for azure without required env vars", () => {
    expect(() => buildClient("azure", "deployment")).toThrow("Azure OpenAI requires");
  });

  it("throws for azure with partial env vars", () => {
    process.env.AZURE_OPENAI_ENDPOINT = "https://test.openai.azure.com";
    expect(() => buildClient("azure", "deployment")).toThrow("Azure OpenAI requires");
  });

  it("creates azure client with all required env vars", () => {
    process.env.AZURE_OPENAI_ENDPOINT = "https://test.openai.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-4";
    const client = buildClient("azure", "gpt-4");
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe("function");
  });

  it("creates lmstudio client", () => {
    const client = buildClient("lmstudio", "qwen3.5-35b-a3b");
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe("function");
  });

  it("creates lmstudio client with custom host", () => {
    process.env.APFELSTRUDEL_LMSTUDIO_HOST = "http://my-custom-host:1234/v1";
    const client = buildClient("lmstudio", "qwen3.5-35b-a3b");
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe("function");
  });

  it("defaults to openai provider for unknown providers", () => {
    // Unknown provider falls through to "default: openai"
    expect(() => buildClient("unknown-provider", "model")).toThrow("OPENAI_API_KEY");
  });
});
