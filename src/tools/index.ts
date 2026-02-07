import type { ToolDefinition } from "../shared/types.ts";
import type { ToolHandler } from "./shared.ts";
export { type ToolHandler, setAppState, getAppState, type AppState } from "./shared.ts";

// Import all tool definitions and handlers
import {
  getPatternDefinition,
  getPatternTool,
  setPatternDefinition,
  setPatternTool,
  modifyPatternDefinition,
  modifyPatternTool,
} from "./pattern.ts";

import {
  playMusicDefinition,
  playMusicTool,
  stopMusicDefinition,
  stopMusicTool,
  strudelEvaluateDefinition,
  strudelEvaluateTool,
} from "./transport.ts";

import { setTempoDefinition, setTempoTool } from "./tempo.ts";

import {
  getStrudelHelpDefinition,
  getStrudelHelpTool,
  listSamplesDefinition,
  listSamplesTool,
  listInstrumentsDefinition,
  listInstrumentsTool,
} from "./reference.ts";

import { getErrorsDefinition, getErrorsTool } from "./errors.ts";

import { manageTodoDefinition, manageTodoTool } from "./todo.ts";

/**
 * Tool handlers registry - maps tool names to handler functions
 */
export const toolHandlers: Record<string, ToolHandler> = {
  get_pattern: getPatternTool,
  set_pattern: setPatternTool,
  modify_pattern: modifyPatternTool,
  play_music: playMusicTool,
  stop_music: stopMusicTool,
  strudel_evaluate: strudelEvaluateTool,
  set_tempo: setTempoTool,
  get_strudel_help: getStrudelHelpTool,
  list_samples: listSamplesTool,
  list_instruments: listInstrumentsTool,
  get_errors: getErrorsTool,
  manage_todo: manageTodoTool,
};

/**
 * Tool definitions for LLM - describes what each tool does
 */
export const toolDefinitions: ToolDefinition[] = [
  getPatternDefinition,
  setPatternDefinition,
  modifyPatternDefinition,
  playMusicDefinition,
  stopMusicDefinition,
  strudelEvaluateDefinition,
  setTempoDefinition,
  getStrudelHelpDefinition,
  listSamplesDefinition,
  listInstrumentsDefinition,
  getErrorsDefinition,
  manageTodoDefinition,
];
