import type { ToolDefinition } from "../shared/types.ts";
import type { ToolHandler } from "./shared.ts";

// =============================================================================
// get_strudel_help - Documentation helper
// =============================================================================

export const getStrudelHelpDefinition: ToolDefinition = {
  name: "get_strudel_help",
  description: "Get documentation for a strudel function or concept",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "Function name or concept (e.g., 'note', 's', 'jux', 'mini-notation', 'effects')",
      },
    },
    required: ["topic"],
  },
};

// Basic strudel documentation (embedded for quick reference)
const STRUDEL_DOCS: Record<string, string> = {
  s: `s("sound") - Play samples by name
Example: s("bd sd hh cp")
Common drums: bd, sd, hh, oh, cp, rim, cr, rd, ht, mt, lt, sh, cb, tb, perc, misc
Use .bank("name") to select sample banks like "RolandTR909"
Use :n or .n() to pick variants: s("hh:0 hh:1 hh:2")`,

  note: `note("pattern") - Play notes/pitches
Example: note("c4 e4 g4"), note("<c3 e3 g3>")
Supports note names (c4, d#5, bb3) and MIDI numbers (60, 64, 67)
Default sound is triangle. Chain with .s("sawtooth") to choose waveform.
Can also use freq(440) for frequency in Hz.`,

  n: `n("pattern") - Select sample variant number or scale degree
With s(): n("0 1 2 3") picks sample variant (0-indexed)
With .scale(): n("0 2 4 6").scale("C:minor") plays scale degrees
Most sample banks have multiple variants`,

  bank: `.bank("name") - Select sample bank
Example: s("bd sd").bank("RolandTR909")
Popular banks: RolandTR909, RolandTR808, RolandCR78, LinndDrum, AkaiLinn, casio
Pattern it: .bank("<RolandTR808 RolandTR909>") to alternate`,

  scale: `.scale("root:type") - Set musical scale
Example: n("0 2 4 6").scale("C:minor")
Root: c, d, e, f, g, a, b (with optional # or b and octave)
Types: major, minor, dorian, mixolydian, lydian, phrygian, pentatonic, blues, chromatic, harmonic:minor, melodic:minor, whole:tone, bebop
.scaleTranspose(n) to shift by scale steps
.transpose(n) to shift by semitones`,

  chord: `chord("symbols") - Set chord symbols for voicing
Example: chord("<C^7 Dm7 G7>").voicing()
Symbols: C, Cm, C7, C^7 (maj7), Cm7, Cdim, Caug, Csus4, C9, etc.
.dict('ireal') for jazz voicings
.rootNotes(2) to extract bass notes`,

  gain: `.gain(value) - Set volume (exponential)
Example: s("bd").gain(0.8)
Pattern it: .gain("0.5 0.8 1 0.3")
.velocity(n) for 0-1 multiplier
.postgain(n) for post-effects gain`,

  speed: `.speed(value) - Playback speed (changes pitch)
Example: s("bd").speed(2) // double speed, octave up
Negative values play backwards: .speed(-1)
Pattern it: .speed("1 2 0.5 -1")`,

  lpf: `.lpf(freq) - Low-pass filter cutoff (Hz)
Example: s("bd").lpf(500) // cut highs above 500Hz
Aliases: cutoff, lp
.lpq(n) - resonance (0-50)
Pattern with signals: .lpf(sine.range(200, 4000).slow(4))
Filter envelope: .lpenv(4).lpa(.01).lpd(.2).lps(0).lpr(.1)`,

  hpf: `.hpf(freq) - High-pass filter cutoff (Hz)
Example: s("hh").hpf(3000)
Aliases: hp, hcutoff
.hpq(n) - resonance
Filter envelope: .hpenv(depth) with .hpa/.hpd/.hps/.hpr`,

  bpf: `.bpf(freq) - Band-pass filter center frequency
.bpq(n) - Q factor
Filter envelope: .bpenv(depth) with .bpa/.bpd/.bps/.bpr`,

  vowel: `.vowel("v") - Formant vowel filter
Vowels: a e i o u ae aa oe ue y uh un en an on
Example: note("c2 eb2").s("sawtooth").vowel("<a e i o u>")`,

  delay: `.delay(amount) - Delay/echo send level (0-1)
Example: s("cp").delay(0.5)
.delaytime(t) - delay time in seconds
.delayfeedback(n) - feedback amount (0-1, keep < 1!)
Shorthand: .delay("0.5:0.25:0.7") = level:time:feedback`,

  room: `.room(amount) - Reverb send level (0-1)
Example: s("sd").room(0.8)
.roomsize(n) - room size (0-10)
.roomfade(t) - reverb decay (seconds)
.roomlp(freq) - reverb lowpass filter
Shorthand: .room("0.8:4") = level:size`,

  jux: `.jux(fn) - Apply function to right channel only
Example: s("bd sd hh cp").jux(rev) // reverse on right side
Creates stereo width. .juxBy(0.5, fn) for adjustable width`,

  rev: `.rev() - Reverse the pattern
Example: note("c d e f").rev() // plays f e d c
.palindrome() - alternate forward/backward each cycle`,

  fast: `.fast(n) - Speed up pattern n times
Example: s("bd sd").fast(2) // twice as fast
Equivalent to *n in mini-notation
.slow(n) does the opposite (= /n)`,

  slow: `.slow(n) - Slow down pattern n times
Example: note("c d e f").slow(2) // half speed
Equivalent to /n in mini-notation`,

  "mini-notation": `Mini-notation syntax:
"bd sd" — sequence: kick then snare
"[bd sd]" — group: play together in one slot
"bd*4" — repeat: 4 times per slot
"bd/2" — slow: spans 2 cycles
"<bd sd>" — alternate: different each cycle
"bd, hh" — stack: layer simultaneously
"~" — rest/silence
"bd?" — 50% random chance; "bd?0.2" = 20%
"bd|sd" — random choice each cycle
"bd!3" — replicate: 3 copies (no speedup)
"bd@2" — elongate: takes 2 time units
"bd(3,8)" — euclidean: 3 beats over 8 steps
"bd(3,8,2)" — euclidean with rotation
"bd:2" — sample variant 2
[a [b c]] — nested subdivision`,

  effects: `Audio effects chain:
.gain(n) — volume (exponential)
.lpf(freq) / .hpf(freq) / .bpf(freq) — filters
.vowel("a") — formant filter
.crush(bits) — bit crush (1=heavy, 16=subtle)
.coarse(n) — sample rate reduction
.distort(n) — distortion
.shape(n) — waveshape distortion
.pan(n) — stereo (0=L, 0.5=C, 1=R)
.phaser(speed) — phaser effect
.delay(n) — delay send (0-1)
.room(n) — reverb send (0-1)
.jux(fn) — stereo function split
.orbit(n) — effect bus routing`,

  setcps: `setcps(n) - Set cycles per second (tempo)
Example: setcps(0.5) // 0.5 cycles per second
With 4 beats per cycle: CPS * 4 * 60 = BPM
0.5 cps = 120 BPM (with 4/4 time)
Common values: 0.25 (slow), 0.5 (moderate), 1 (fast), 2 (very fast)
.cpm(n) - cycles per minute for a pattern`,

  hush: `hush() - Stop all sounds immediately
Use when things get too loud or to reset`,

  adsr: `ADSR Envelope - controls sound shape over time
.attack(t) — time to reach peak (seconds)
.decay(t) — time to reach sustain level
.sustain(n) — held level (0-1)
.release(t) — fade-out time after note ends
Shorthand: .adsr(".01:.1:.5:.2") = a:d:s:r
Note: sustain is only heard if < 1`,

  fm: `FM Synthesis - frequency modulation
.fm(index) — modulation index (brightness, 0-32+)
.fmh(ratio) — harmonicity ratio (whole numbers = natural timbre)
.fmattack(t) / .fmdecay(t) / .fmsustain(n) / .fmrelease(t)
Example: note("c e g").fm(4).fmh(2).fmdecay(.2).fmsustain(0)`,

  signals: `Continuous signals (0 to 1 range):
sine, cosine, saw, tri, square — waveform LFOs
rand — random values
perlin — smooth random (Perlin noise)
irand(n) — random integers 0 to n-1
Bipolar (-1 to 1): sine2, saw2, tri2, rand2
Usage: .lpf(sine.range(200, 4000).slow(4))
.segment(n) — sample at n points per cycle`,

  samples: `Sample manipulation:
.begin(n) / .end(n) — trim (0-1)
.speed(n) — playback speed (neg = reverse)
.loop(1) — loop sample
.loopAt(cycles) — fit to n cycles
.chop(n) — granular: cut into n slices
.slice(n, pattern) — slice and resequence
.splice(n, pattern) — slice with tempo match
.clip(n) — multiply duration (legato)
.fit() — fit sample to event duration
.cut(group) — cut group (mute same group)`,

  superimpose: `Accumulation - layering transforms:
.superimpose(fn) — overlay transformed copy
.layer(fn1, fn2) — apply multiple functions
.off(time, fn) — delayed superimpose
.echo(times, time, feedback) — repeated echo
.echoWith(times, time, fn) — echo with transform
Example: note("c e g").off(1/8, x => x.add(7))`,

  random: `Random modifiers:
.degrade() — randomly remove 50% of events
.degradeBy(n) — remove n% (0-1)
.sometimes(fn) — apply fn 50% of the time
.often(fn) / .rarely(fn) — 75% / 25%
.almostAlways(fn) / .almostNever(fn) — 90% / 10%
choose(a, b, c) — random pick per event
chooseCycles(a, b, c) — random pick per cycle`,

  conditional: `Conditional modifiers:
.every(n, fn) — apply fn every n cycles
.firstOf(n, fn) / .lastOf(n, fn) — every nth cycle
.when(binaryPat, fn) — apply when pattern is true
.chunk(n, fn) — rotate fn across n subdivisions`,

  stack: `stack(pat1, pat2, ...) - Layer patterns simultaneously
Example: stack(s("bd sd"), note("c3 e3").s("sawtooth"))
In mini-notation: "bd sd, hh*4" (comma = stack)
Use with different sounds to build multi-part arrangements`,

  cat: `cat(pat1, pat2, ...) - Concatenate, one per cycle
Example: cat("c e", "f a", "g b").note()
Same as <...> in mini-notation
seq() / fastcat() puts all in one cycle instead`,

  struct: `.struct(pattern) - Apply rhythmic structure
Example: note("c3,e3,g3").struct("x ~ x ~ ~ x ~ x")
Forces the note chord into the given rhythm`,

  euclid: `.euclid(pulses, steps) - Euclidean rhythm
Example: s("bd").euclid(3,8) = "bd ~ ~ bd ~ ~ bd ~"
.euclidRot(3,8,2) — with rotation
Popular: (3,8)=tresillo, (5,8)=cinquillo, (7,16)=Brazilian`,

  synths: `Built-in synthesizer waveforms:
sine, sawtooth, square, triangle — basic oscillators
white, pink, brown — noise types
Default for note() is triangle
Example: note("c3 e3 g3").s("sawtooth")
FM: .fm(index).fmh(ratio) for complex timbres
Vibrato: .vib(freq).vibmod(depth)`,

  pan: `.pan(n) - Stereo position
0 = full left, 0.5 = center, 1 = full right
Pattern: .pan(sine.slow(2)) for auto-pan
.jux(fn) for stereo split effects`,

  iter: `.iter(n) - Rotate subdivisions each cycle
Example: note("0 1 2 3".scale('A:minor')).iter(4)
Cycle 1: 0 1 2 3, Cycle 2: 1 2 3 0, etc.
.iterBack(n) — reverse rotation`,

  orbit: `.orbit(n) - Route to effect bus
Patterns on the same orbit share delay/reverb.
Default orbit is 1. Use different orbits for independent effects.
Example: s("bd").room(0.5).orbit(1)`,
};

export const getStrudelHelpTool: ToolHandler = async (args) => {
  const topic = (args.topic as string).toLowerCase().trim();

  // Direct match
  if (STRUDEL_DOCS[topic]) {
    return {
      id: "get_strudel_help",
      output: STRUDEL_DOCS[topic],
    };
  }

  // Fuzzy match
  const keys = Object.keys(STRUDEL_DOCS);
  const match = keys.find((k) => k.includes(topic) || topic.includes(k));
  if (match) {
    return {
      id: "get_strudel_help",
      output: STRUDEL_DOCS[match],
    };
  }

  // Not found - list available topics
  return {
    id: "get_strudel_help",
    output: `Topic "${topic}" not found. Available topics: ${keys.join(", ")}`,
  };
};

// =============================================================================
// list_samples - List available sample banks
// =============================================================================

export const listSamplesDefinition: ToolDefinition = {
  name: "list_samples",
  description: "List available sample banks or describe common samples",
  parameters: {
    type: "object",
    properties: {
      bank: {
        type: "string",
        description: "Sample bank name to get details about (optional)",
      },
    },
  },
};

// Common sample banks reference (includes Dirt-Samples from GitHub loaded at runtime)
const SAMPLE_BANKS: Record<string, string> = {
  default:
    "bd, sd, hh/ch, oh, cp, cl, rim, lt, mt, ht, cb, ma, shaker, perc, ride, crash, bass, lead, pluck, pad, bell, organ, fx, noise (always available locally)",
  ApfelKit:
    "Local drum kit (always available offline): bd, sd, hh/ch, oh, cp, cl, rim, lt, mt, ht, cb, ma, shaker, perc, ride, crash, bass, lead, pluck, pad, bell, organ, fx, noise. Use with .bank(\"ApfelKit\")",
  RolandTR808:
    "Classic TR-808 drum machine (from Dirt-Samples, requires internet on first load): bd, sd, hh, oh, cp, cl, rim, lt, mt, ht. Use with .bank(\"RolandTR808\")",
  RolandTR909:
    "Classic TR-909 drum machine (from Dirt-Samples, requires internet on first load): bd, sd, hh, oh, cp, cl, rim, lt, mt, ht. Use with .bank(\"RolandTR909\")",
  "808":
    "TR-808 individual sounds (Dirt-Samples): CB, CH, CL, CP, MA, RS. Use with .n() for variants",
  "808bd":
    "TR-808 bass drums (25 variations). Use .n(0-24) to select",
  "808sd":
    "TR-808 snare drums (25 variations). Use .n(0-24) to select",
  "808oh":
    "TR-808 open hi-hats (5 variations). Use .n(0-4)",
  "808hc":
    "TR-808 closed hi-hats (5 variations). Use .n(0-4)",
  "909":
    "TR-909 bass drum (Dirt-Samples)",
  bd: "Bass drums — 2 local variants, 24+ from Dirt-Samples. Use .n(0-23)",
  sd: "Snare drums — 2 local variants, more from Dirt-Samples. Use .n() for variants",
  hh: "Closed hi-hats — 2 local variants. Use .n() for variants",
  cp: "Hand claps — 1 local variant. Use .n() for variants",
  cr: "Crash cymbals (Dirt-Samples, 6 variations)",
  cb: "Cowbell — 1 local variant",
  casio: "Casio keyboard (Dirt-Samples): high, low, noise",
  arpy: "Arpeggiated synth notes (Dirt-Samples, 11 variations)",
  bass: "Bass sounds — 1 local variant, more from Dirt-Samples",
  feel: "Drum kit (Dirt-Samples): BD, HH, Sd + sub",
  clubkick: "Club kick drums (Dirt-Samples, 5 variations)",
  east: "Eastern percussion (Dirt-Samples): taiko, shime, ohkawa",
  electro1: "Electro drum kit (Dirt-Samples): kick, snare, hh, ride, crash, hits, perc",
  fm: "Classic breakbeats and vocal samples (Dirt-Samples)",
  future: "Futuristic kicks and percussion (Dirt-Samples)",
  gab: "Gabber/hardcore kicks and sounds (Dirt-Samples, 10 variations)",
  glitch: "Glitch percussion (Dirt-Samples): BD, CB, FX, HH, OH, SN",
  birds: "Bird song recordings (Dirt-Samples, 10 samples)",
  bottle: "Bottle percussion (Dirt-Samples, 13 samples)",
  amencutup: "Amen break sliced into 32 pieces (Dirt-Samples)",
  drumtraks: "Sequential Drumtraks (Dirt-Samples): cabasa, claps, cowbell, crash, hats, kick, ride, rimshot, snare, tambourine, toms",
  metal: "Metal/industrial percussion (Dirt-Samples)",
  jazz: "Jazz drum kit samples (Dirt-Samples)",
  gm: "General MIDI sounds (Dirt-Samples, use with .n() for variants)",
  house: "House music drum samples (Dirt-Samples)",
  techno: "Techno percussion (Dirt-Samples)",
};

export const listSamplesTool: ToolHandler = async (args) => {
  const bank = args.bank as string | undefined;

  if (bank) {
    const bankLower = bank.toLowerCase();
    const info = SAMPLE_BANKS[bankLower] || SAMPLE_BANKS[bank];
    if (info) {
      return {
        id: "list_samples",
        output: `Bank "${bank}": ${info}`,
      };
    }
    return {
      id: "list_samples",
      output: `Bank "${bank}" not in quick reference. Try using it anyway with .bank("${bank}"). Use list_instruments to search for it in the full library.`,
    };
  }

  // List all banks
  const output = Object.entries(SAMPLE_BANKS)
    .map(([name, desc]) => `• ${name}: ${desc}`)
    .join("\n");

  return {
    id: "list_samples",
    output: `Available sample banks:\n${output}\n\nUse with: s("bd sd").bank("RolandTR909")\n\nFor the full instrument library (hundreds of banks), use the list_instruments tool.`,
  };
};

// =============================================================================
// list_instruments - Dynamic instrument discovery from Dirt-Samples manifest
// =============================================================================

export const listInstrumentsDefinition: ToolDefinition = {
  name: "list_instruments",
  description:
    "Search and list all available instruments/samples from the Dirt-Samples library. Returns real instrument names, variant counts, and sample filenames. Use this to discover what sounds are available.",
  parameters: {
    type: "object",
    properties: {
      search: {
        type: "string",
        description:
          "Filter instruments by name (case-insensitive substring match). Omit to list all.",
      },
      offset: {
        type: "number",
        description:
          "Start index for pagination (default 0). Use when there are more results.",
      },
      limit: {
        type: "number",
        description:
          "Max instruments to return (default 40, max 100).",
      },
    },
  },
};

/** Dirt-Samples manifest: maps bank name → array of file paths */
type SampleManifest = Record<string, string[] | string>;

const LOCAL_SAMPLES_PATH = "./public/vendor/strudel/samples/strudel.json";
const DIRT_SAMPLES_PATH = "./public/vendor/strudel/samples/dirt-samples.json";

let cachedManifest: SampleManifest | null = null;
let manifestError: string | null = null;

/** Exported for testing */
export function _resetManifestCache(): void {
  cachedManifest = null;
  manifestError = null;
}

export function _setManifestCache(manifest: SampleManifest): void {
  cachedManifest = manifest;
  manifestError = null;
}

async function loadManifest(): Promise<SampleManifest> {
  if (cachedManifest) return cachedManifest;

  const merged: SampleManifest = {};

  // Load vendored manifests (no network required)
  for (const path of [LOCAL_SAMPLES_PATH, DIRT_SAMPLES_PATH]) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        const data = (await file.json()) as SampleManifest;
        for (const [k, v] of Object.entries(data)) {
          if (k !== "_base") merged[k] = v;
        }
      }
    } catch {
      // ignore individual file load failures
    }
  }

  if (Object.keys(merged).length === 0) {
    throw new Error("No sample manifest could be loaded");
  }

  cachedManifest = merged;
  return merged;
}

interface InstrumentInfo {
  name: string;
  variants: number;
  files: string[];
}

function summarizeManifest(
  manifest: SampleManifest,
  search?: string
): InstrumentInfo[] {
  const results: InstrumentInfo[] = [];
  const searchLower = search?.toLowerCase();

  for (const [name, value] of Object.entries(manifest)) {
    if (typeof value === "string") continue; // skip _base etc
    if (!Array.isArray(value)) continue;
    if (searchLower && !name.toLowerCase().includes(searchLower)) continue;
    results.push({ name, variants: value.length, files: value });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

export const listInstrumentsTool: ToolHandler = async (args) => {
  const search = args.search as string | undefined;
  const offset = Math.max(0, (args.offset as number | undefined) ?? 0);
  const limit = Math.min(100, Math.max(1, (args.limit as number | undefined) ?? 40));

  let manifest: SampleManifest;
  try {
    manifest = await loadManifest();
  } catch (err) {
    return {
      id: "list_instruments",
      output: `Failed to load instrument list: ${err instanceof Error ? err.message : String(err)}`,
      error: true,
    };
  }

  const all = summarizeManifest(manifest, search);
  const page = all.slice(offset, offset + limit);
  const total = all.length;

  if (total === 0) {
    return {
      id: "list_instruments",
      output: search
        ? `No instruments matching "${search}". Try a broader search or omit the search parameter.`
        : "No instruments available.",
    };
  }

  const lines = page.map((inst) => {
    const filePreview =
      inst.files.length <= 4
        ? inst.files.map((f) => f.split("/").pop()).join(", ")
        : `${inst.files.slice(0, 3).map((f) => f.split("/").pop()).join(", ")} ...`;
    return `• ${inst.name} (${inst.variants} variant${inst.variants !== 1 ? "s" : ""}): ${filePreview}`;
  });

  let header = search
    ? `Instruments matching "${search}": ${total} found`
    : `All instruments: ${total} total`;

  if (total > offset + limit) {
    header += ` (showing ${offset + 1}-${offset + page.length}, use offset=${offset + limit} for more)`;
  } else if (offset > 0) {
    header += ` (showing ${offset + 1}-${offset + page.length})`;
  }

  const output = `${header}\n${lines.join("\n")}\n\nUsage: s("${page[0]?.name ?? "bd"}") or s("bd").bank("${page[0]?.name ?? "RolandTR808"}")`;

  return { id: "list_instruments", output };
};
