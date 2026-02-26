import OpenAI, { AzureOpenAI } from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { LLMClient, Message, ToolCallDescriptor, ToolDefinition } from "../shared/types.ts";

/**
 * Echo client for testing - returns a simple echo of the last user message
 */
class EchoClient implements LLMClient {
  async generate(messages: Message[]): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return { content: lastUser?.content ? `Echo: ${lastUser.content}` : "Echo" };
  }
}

/**
 * OpenAI-compatible client (works with OpenAI and compatible APIs)
 */
export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(model: string, apiKey: string, baseURL?: string, defaultQuery?: Record<string, string>) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
      defaultQuery,
    });
    this.model = model;
  }

  async generate(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }> {
    return generateFromOpenAI(this.client, this.model, messages, tools);
  }
}

/**
 * Azure OpenAI client using the SDK's AzureOpenAI class (supports Entra ID auth)
 */
export class AzureOpenAIClient implements LLMClient {
  private client: AzureOpenAI;
  private model: string;

  constructor(model: string, client: AzureOpenAI) {
    this.client = client;
    this.model = model;
  }

  async generate(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }> {
    return generateFromOpenAI(this.client, this.model, messages, tools);
  }
}

/**
 * Anthropic client using the official SDK
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;

  constructor(model: string, apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generate(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }> {
    // Extract system message
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemMsg?.content ?? undefined,
      messages: toAnthropicMessages(nonSystemMessages),
      tools: tools?.map(toAnthropicTool),
    });

    let textContent: string | null = null;
    const toolCalls: ToolCallDescriptor[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textContent = block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      result.push({ role: "user", content: m.content ?? "" });
    } else if (m.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      if (m.tool_calls) {
        for (const call of m.tool_calls) {
          content.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
      }
      result.push({ role: "assistant", content });
    } else if (m.role === "tool") {
      // Anthropic expects tool results as user messages with tool_result content blocks.
      // Consecutive tool messages should be grouped into a single user message.
      const lastMsg = result[result.length - 1];
      const toolResultBlock: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "",
        content: m.content ?? "",
      };
      if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
        (lastMsg.content as Anthropic.ContentBlockParam[]).push(toolResultBlock);
      } else {
        result.push({ role: "user", content: [toolResultBlock] });
      }
    }
  }

  return result;
}

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  };
}

async function generateFromOpenAI(
  client: OpenAI,
  model: string,
  messages: Message[],
  tools?: ToolDefinition[]
): Promise<{ content: string | null; toolCalls?: ToolCallDescriptor[] }> {
  const completion = await client.chat.completions.create({
    model,
    messages: toOpenAIMessages(messages),
    tools: tools?.map(toOpenAITool),
    tool_choice: tools?.length ? "auto" : undefined,
  });

  const choice = completion.choices[0]?.message;
  if (!choice) return { content: null };

  const toolCalls = choice.tool_calls?.map((call) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      args = {};
    }
    return {
      id: call.id,
      name: call.function.name,
      arguments: args,
    } satisfies ToolCallDescriptor;
  });

  const content = typeof choice.content === "string" ? choice.content : null;
  return { content, toolCalls };
}

/**
 * Build an LLM client based on provider configuration
 */
export function buildClient(provider: string, model: string): LLMClient {
  if (provider === "echo") {
    return new EchoClient();
  }

  if (provider === "azure") {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-01-preview";
    const key = process.env.AZURE_OPENAI_API_KEY;

    if (!endpoint || !deployment) {
      throw new Error("Azure OpenAI requires AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT");
    }

    let client: AzureOpenAI;
    if (key) {
      client = new AzureOpenAI({ apiKey: key, endpoint, deployment, apiVersion });
    } else {
      // No API key — use Entra ID / DefaultAzureCredential (managed identity, CLI, etc.)
      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";
      const tokenProvider = getBearerTokenProvider(credential, scope);
      client = new AzureOpenAI({ azureADTokenProvider: tokenProvider, endpoint, deployment, apiVersion });
    }

    return new AzureOpenAIClient(deployment, client);
  }

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic requires ANTHROPIC_API_KEY environment variable");
    }
    return new AnthropicClient(model, apiKey);
  }

  // Default: OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI requires OPENAI_API_KEY environment variable");
  }

  const baseURL = process.env.OPENAI_BASE_URL;
  return new OpenAIClient(model, apiKey, baseURL);
}

function toOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls) {
      return {
        role: "assistant",
        content: m.content ?? "",
        tool_calls: m.tool_calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      } satisfies ChatCompletionMessageParam;
    }
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content ?? "",
        tool_call_id: m.tool_call_id ?? "",
      } satisfies ChatCompletionMessageParam;
    }
    return { role: m.role, content: m.content ?? "" } satisfies ChatCompletionMessageParam;
  });
}

function toOpenAITool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  } satisfies ChatCompletionTool;
}
