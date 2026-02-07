import type { ToolDefinition } from "../shared/types.ts";
import type { ToolHandler } from "./shared.ts";
import { getAppState, clearEvalErrors } from "./shared.ts";

// =============================================================================
// get_errors - Check for client-side evaluation errors
// =============================================================================

export const getErrorsDefinition: ToolDefinition = {
  name: "get_errors",
  description:
    "Check for recent client-side evaluation errors. " +
    "Use this after setting a pattern to see if it compiled and played successfully. " +
    "Returns any errors reported by the browser and clears them.",
  parameters: {
    type: "object",
    properties: {},
  },
};

export const getErrorsTool: ToolHandler = async () => {
  const state = getAppState();
  const errors = state.evalErrors.map((e) => e.message);

  if (errors.length === 0) {
    return {
      id: "get_errors",
      output: "No errors. The pattern is running successfully.",
    };
  }

  const output = `${errors.length} error(s):\n${errors.join("\n")}`;
  clearEvalErrors();

  return {
    id: "get_errors",
    output,
    error: true,
  };
};
