import OpenAI, { AzureOpenAI } from "openai";
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

  if (provider === "lmstudio") {
    const baseURL = process.env.APFELSTRUDEL_LMSTUDIO_HOST || "http://localhost:1234/v1";
    const apiKey = "lm-studio"; // LM Studio doesn't require a real key
    return new OpenAIClient(model, apiKey, baseURL);
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
