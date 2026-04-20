import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { SessionState } from "../shared/types.ts";

const DATA_DIR = ".apfelstrudel";
const SESSION_FILE = "session.json";

const DEFAULT_PATTERN = `stack(
  s("bd [~ bd] sd [bd ~ ]"),
  s("[~ hh]*4").gain(.6),
  note("<c2 [c2 eb2] f2 [f2 ab2]>")
    .s("sawtooth").lpf(600).decay(.15).sustain(0),
  note("<[c4 eb4 g4] [f4 ab4 c5] [eb4 g4 bb4] [ab4 c5 eb5]>/2")
    .s("triangle").gain(.35).delay(.25).room(.3)
)`;

const DEFAULT_SESSION: SessionState = {
  tabs: [
    {
      id: "default",
      title: "Main Loop",
      content: DEFAULT_PATTERN,
    },
  ],
  activeTabId: "default",
};

export async function loadSession(): Promise<SessionState> {
  try {
    const data = await readFile(join(DATA_DIR, SESSION_FILE), "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_SESSION;
    }
    console.error("[Session] Failed to load session:", err);
    return DEFAULT_SESSION;
  }
}

export async function saveSession(session: SessionState): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(join(DATA_DIR, SESSION_FILE), JSON.stringify(session, null, 2));
  } catch (err) {
    console.error("[Session] Failed to save session:", err);
  }
}
