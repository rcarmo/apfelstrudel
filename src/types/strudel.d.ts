declare module "@strudel/web" {
  export function initStrudel(options?: Record<string, unknown>): Promise<{ evaluate: (code: string) => Promise<void> }>;
  export const controls: { setCps: (cps: number) => void };
  export function hush(): void;
  export function evalScope(...modules: unknown[]): Promise<unknown>;
  export function transpiler(input: string, options?: Record<string, unknown>): {
    output: string;
    miniLocations?: number[][];
    widgets?: unknown[];
  };
  export function samples(sampleMap: string | Record<string, unknown>, baseUrl?: string, options?: Record<string, unknown>): Promise<void>;
  export const webaudioOutput: (...args: unknown[]) => unknown;
}

declare module "@strudel/mini" {
  export const mini: unknown;
  export function stack(...patterns: unknown[]): unknown;
  export function cat(...patterns: unknown[]): unknown;
}

declare module "@strudel/webaudio" {
  export function samples(...args: unknown[]): unknown;
  export function getAudioContext(): AudioContext;
  export function setAudioContext(ctx: AudioContext): AudioContext;
  export function initAudio(options?: Record<string, unknown>): Promise<void>;
  export const webaudioOutput: (...args: unknown[]) => unknown;
}

declare module "@strudel/core" {
  export const Pattern: unknown;
}

declare module "@strudel/draw" {
  export const pianoroll: unknown;
  export const getDrawContext: unknown;
}

declare module "@strudel/codemirror" {
  interface InitEditorOptions {
    initialCode?: string;
    root?: HTMLElement;
    onChange?: (update: unknown) => void;
    onEvaluate?: () => void;
    onStop?: () => void;
    mondo?: boolean;
  }
  export function initEditor(options: InitEditorOptions): unknown;
  export function initTheme(theme: string): void;
  export class StrudelMirror {
    constructor(options: Record<string, unknown>);
    editor: unknown;
    repl: { evaluate: (code: string, autostart?: boolean) => Promise<unknown>; setCps?: (cps: number) => unknown };
    evaluate: (autostart?: boolean) => Promise<unknown>;
    stop: () => Promise<void>;
  }
}

declare module "superdough" {
  export function samples(sampleMap: string | Record<string, unknown>, baseUrl?: string, options?: Record<string, unknown>): Promise<void>;
}
