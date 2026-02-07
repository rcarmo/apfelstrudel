import type { ToolDefinition } from "../shared/types.ts";
import type { ToolHandler } from "./shared.ts";
import { getAppState, clearEvalErrors, getRecentEvalErrors } from "./shared.ts";

// =============================================================================
// get_pattern - Read current pattern code
// =============================================================================

export const getPatternDefinition: ToolDefinition = {
  name: "get_pattern",
  description: "Get the current strudel pattern code from the editor",
  parameters: {
    type: "object",
    properties: {},
  },
};

export const getPatternTool: ToolHandler = async () => {
  const state = getAppState();
  return {
    id: "get_pattern",
    output: state.currentPattern || "(empty pattern)",
  };
};

// =============================================================================
// set_pattern - Write new pattern code
// =============================================================================

export const setPatternDefinition: ToolDefinition = {
  name: "set_pattern",
  description: "Set a new strudel pattern in the editor",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The strudel pattern code to set",
      },
      autoplay: {
        type: "boolean",
        description: "Whether to start playing immediately (default: true)",
      },
    },
    required: ["code"],
  },
};

export const setPatternTool: ToolHandler = async (args) => {
  const code = args.code as string;
  const autoplay = args.autoplay !== false; // default true

  const state = getAppState();
  state.currentPattern = code;

  // Clear old errors before sending new pattern
  clearEvalErrors();

  // Notify frontend to update pattern
  state.broadcast({
    type: "set_pattern",
    code,
    autoplay,
  });

  // Wait briefly for eval errors to arrive from the client
  await new Promise((r) => setTimeout(r, 600));

  const errors = getRecentEvalErrors(2000);
  if (errors.length > 0) {
    return {
      id: "set_pattern",
      output: `Pattern updated but evaluation failed:\n${errors.join("\n")}\n\nPlease fix the code and try again.`,
      error: true,
    };
  }

  return {
    id: "set_pattern",
    output: `Pattern updated${autoplay ? " and playing" : ""}:\n${code}`,
  };
};

// =============================================================================
// modify_pattern - Apply modifications to current pattern
// =============================================================================

export const modifyPatternDefinition: ToolDefinition = {
  name: "modify_pattern",
  description: "Modify the current pattern by adding effects, changing sounds, or adjusting structure",
  parameters: {
    type: "object",
    properties: {
      transformation: {
        type: "string",
        enum: ["add_effect", "change_sound", "adjust_rhythm", "add_layer", "remove_layer", "custom"],
        description: "Type of modification to apply",
      },
      details: {
        type: "string",
        description: "Specific modification details (e.g., effect name, new sound, etc.)",
      },
      newCode: {
        type: "string",
        description: "The complete new pattern code after modification",
      },
    },
    required: ["transformation", "newCode"],
  },
};

export const modifyPatternTool: ToolHandler = async (args) => {
  const transformation = args.transformation as string;
  const details = (args.details as string) || "";
  const newCode = args.newCode as string;

  const state = getAppState();
  const oldCode = state.currentPattern;
  state.currentPattern = newCode;

  clearEvalErrors();

  // Notify frontend
  state.broadcast({
    type: "set_pattern",
    code: newCode,
    autoplay: true,
  });

  await new Promise((r) => setTimeout(r, 600));

  const errors = getRecentEvalErrors(2000);
  if (errors.length > 0) {
    return {
      id: "modify_pattern",
      output: `Applied ${transformation}${details ? ` (${details})` : ""} but evaluation failed:\n${errors.join("\n")}\n\nPrevious code: ${oldCode}\nNew code: ${newCode}\n\nPlease fix the code and try again.`,
      error: true,
    };
  }

  return {
    id: "modify_pattern",
    output: `Applied ${transformation}${details ? ` (${details})` : ""}:\nBefore: ${oldCode}\nAfter: ${newCode}`,
  };
};
