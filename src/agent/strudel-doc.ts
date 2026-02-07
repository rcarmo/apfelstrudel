/**
 * Comprehensive Strudel reference for inclusion in the AI system prompt.
 * Kept compact to fit within LLM context limits while covering all major features.
 */
export const STRUDEL_REFERENCE = `
## Strudel Quick Reference

Strudel is a JavaScript port of TidalCycles for live-coding music patterns.

### Mini-Notation
Patterns are written as strings. Events are squeezed into one cycle (not appended).
- \`"a b c"\` — sequence: a, b, c equally spaced in one cycle
- \`"[a b] c"\` — group: a+b share one slot, c gets the other
- \`"a*3"\` — repeat: a plays 3 times per slot
- \`"a/2"\` — slow: a spans 2 cycles
- \`"<a b c>"\` — alternate: one per cycle (= \`"[a b c]/3"\`)
- \`"a, b"\` — stack: a and b play simultaneously (polyphony)
- \`"a:2"\` — select: sample variant 2 (with \`s\`) or param colon syntax
- \`"~"\` — rest/silence
- \`"a?"\` — 50% chance to play; \`"a?0.2"\` = 20% chance
- \`"a|b"\` — random choice each cycle
- \`"a!3"\` — replicate: 3 copies (doesn't speed up)
- \`"a@2"\` — elongate: takes 2 time slots
- \`"a(3,8)"\` — euclidean rhythm: 3 beats over 8 steps
- \`"a(3,8,2)"\` — euclidean with rotation offset
- Nesting: \`"[a [b c]] d"\` — unlimited subdivision depth
- Backticks for multiline: \`\\\`a b\\nc d\\\`\`

### Sound Sources

#### Samples
\`s("bd sd hh cp")\` — play samples by name
Common drums: bd, sd, hh, oh, cp, rim, cr, rd, ht, mt, lt, sh, cb, tb, perc, misc
\`.bank("RolandTR808")\` — select drum machine bank
\`.n("0 1 2 3")\` — pick sample variant (0-indexed)
\`s("bd:0 bd:1 bd:2")\` — colon syntax for variant selection

The app loads the full tidalcycles/dirt-samples collection (vendored locally for offline use).
This includes hundreds of kits: 808, 808bd, 808sd, 808cy, 808oh, 808hc, 909, ab, arpy, bass, bass1-3,
bd (24 variants), casio, clubkick, cp, cr, drum, drumtraks, east, electro1, feel, fm,
future, gab, glitch, birds, bottle, amencutup, metal, jazz, and many more.
Use \`list_samples\` tool to get details about specific banks.

#### Synths
\`note("c3 e3 g3").s("sawtooth")\` — built-in waveforms
Basic: sine, sawtooth, square, triangle (aliases: sin, saw, sqr, tri)
Extended: supersaw, pulse, sbd (synth bass drum), bytebeat
Noise: white, pink, brown
ZZFX: zzfx, z_sine, z_sawtooth, z_triangle, z_square, z_tan, z_noise
Default sound for \`note()\` is triangle.

#### Notes & Pitch
\`note("c4 e4 g4")\` — note names (letter + octave)
\`note("60 64 67")\` — MIDI numbers
\`freq(440)\` — frequency in Hz
\`n("0 2 4").scale("C:minor")\` — scale degrees (0-indexed)
\`note("c3").add(7)\` — transpose by semitones

### Scales & Tonal
\`.scale("C:minor")\` — quantize to scale (root:type)
Scale types: major, minor, dorian, mixolydian, lydian, phrygian, locrian, pentatonic, blues, bebop, chromatic, whole:tone, harmonic:minor, melodic:minor, etc.
\`.transpose(n)\` — shift by n semitones
\`.scaleTranspose(n)\` — shift by n scale steps

#### Chords & Voicings
\`chord("<C^7 Dm7 G7>").voicing()\` — chord voicings
\`.dict('ireal')\` — voicing dictionary
\`.rootNotes(2)\` — extract root notes at octave 2

### Pattern Constructors
\`cat(a, b, c)\` — one per cycle (\`<a b c>\`)
\`seq(a, b, c)\` — all in one cycle (\`a b c\`)
\`stack(a, b)\` — simultaneous (\`a, b\`)
\`silence\` — empty pattern
\`run(n)\` — numbers 0 to n-1
\`arrange([4, pat1], [2, pat2])\` — multi-cycle arrangement
\`polymeter(a, b)\` — align step counts

### Time Modifiers
\`.fast(n)\` — speed up n times (= \`*n\`)
\`.slow(n)\` — slow down n times (= \`/n\`)
\`.rev()\` — reverse the pattern
\`.palindrome()\` — alternate forward/backward each cycle
\`.early(n)\` / \`.late(n)\` — shift in time by n cycles
\`.euclid(pulses, steps)\` — euclidean rhythm
\`.iter(n)\` — rotate subdivisions each cycle
\`.ply(n)\` — repeat each event n times
\`.segment(n)\` — sample continuous patterns at n events/cycle
\`.compress(from, to)\` — squeeze into time range
\`.linger(frac)\` — loop a fraction of the pattern
\`.fastGap(n)\` — speed up but leave gap
\`.inside(n, fn)\` / \`.outside(n, fn)\` — apply fn at different time scale
\`.swing(n)\` — swing feel (subdivisions)
\`.ribbon(offset, cycles)\` — loop a section

### Value Modifiers
\`.add(n)\` — add to values
\`.sub(n)\` — subtract
\`.mul(n)\` — multiply
\`.div(n)\` — divide
\`.range(min, max)\` — scale 0-1 to range
\`.rangex(min, max)\` — exponential range

### Signals (Continuous Patterns)
\`sine\` — 0 to 1 sine wave
\`cosine\` — 0 to 1 cosine wave
\`saw\` — 0 to 1 sawtooth
\`tri\` — 0 to 1 triangle
\`square\` — 0 to 1 square
\`rand\` — random 0 to 1
\`perlin\` — smooth random 0 to 1
\`irand(n)\` — random integers 0 to n-1
Bipolar versions: sine2, saw2, tri2, rand2 (range -1 to 1)
Usage: \`.lpf(sine.range(200, 4000).slow(4))\`

### Amplitude & Dynamics
\`.gain(n)\` — volume (exponential, default 1)
\`.velocity(n)\` — velocity 0-1 (multiplied with gain)
\`.postgain(n)\` — gain after effects

#### ADSR Envelope
\`.attack(t)\` — attack time (seconds)
\`.decay(t)\` — decay time
\`.sustain(n)\` — sustain level (0-1)
\`.release(t)\` — release time
\`.adsr("a:d:s:r")\` — shorthand

### Filters
\`.lpf(freq)\` — low-pass filter cutoff (Hz); aliases: cutoff, lp
\`.lpq(n)\` — low-pass resonance (0-50)
\`.hpf(freq)\` — high-pass filter; aliases: hp, hcutoff
\`.hpq(n)\` — high-pass resonance
\`.bpf(freq)\` — band-pass filter center
\`.bpq(n)\` — band-pass Q
\`.vowel("a e i o u")\` — formant filter

#### Filter Envelopes
\`.lpenv(depth)\` — LP envelope depth; with \`.lpa(t) .lpd(t) .lps(n) .lpr(t)\`
\`.hpenv(depth)\` — HP envelope depth; with \`.hpa(t) .hpd(t) .hps(n) .hpr(t)\`
\`.bpenv(depth)\` — BP envelope depth; with \`.bpa(t) .bpd(t) .bps(n) .bpr(t)\`

### Pitch Modulation
\`.penv(semitones)\` — pitch envelope depth
\`.pattack(t)\` / \`.pdecay(t)\` / \`.prelease(t)\` — pitch envelope shape
\`.vib(freq)\` — vibrato frequency (Hz)
\`.vibmod(depth)\` — vibrato depth (semitones)

### FM Synthesis
\`.fm(index)\` — FM modulation index (brightness)
\`.fmh(ratio)\` — FM harmonicity ratio (timbre)
\`.fmattack(t)\` / \`.fmdecay(t)\` / \`.fmsustain(n)\` / \`.fmrelease(t)\` — FM envelope

### Effects
\`.pan(n)\` — stereo position (0=left, 0.5=center, 1=right)
\`.delay(amount)\` — delay send (0-1)
\`.delaytime(t)\` — delay time
\`.delayfeedback(n)\` — delay feedback (0-1, <1!)
\`.room(amount)\` — reverb send (0-1)
\`.roomsize(n)\` — reverb size (0-10)
\`.roomfade(t)\` — reverb decay time
\`.roomlp(freq)\` — reverb lowpass
\`.crush(bits)\` — bit crush (1=heavy, 16=subtle)
\`.coarse(n)\` — sample rate reduction
\`.distort(amount)\` — distortion; \`"amount:postgain:type"\`
\`.shape(amount)\` — waveshape distortion
\`.phaser(speed)\` — phaser effect
\`.phaserdepth(n)\` — phaser depth (0-1)
\`.speed(n)\` — playback speed (negative = reverse)
\`.cut(group)\` — cut group (open/closed hihat style)
\`.orbit(n)\` — route to effect bus

### Stereo
\`.jux(fn)\` — apply fn to right channel only
\`.juxBy(width, fn)\` — jux with stereo width (0-1)

### Sample Manipulation
\`.begin(n)\` / \`.end(n)\` — trim sample (0-1)
\`.loop(1)\` — loop sample
\`.loopAt(cycles)\` — fit sample to n cycles
\`.chop(n)\` — granular: cut into n slices
\`.slice(n, pattern)\` — slice and resequence
\`.splice(n, pattern)\` — slice with speed adjustment
\`.clip(n)\` — multiply duration (legato)
\`.fit()\` — fit sample to event duration

### Randomness
\`.degrade()\` — randomly remove 50% of events
\`.degradeBy(n)\` — remove n% (0-1)
\`.sometimesBy(prob, fn)\` — apply fn with probability
\`.sometimes(fn)\` — 50% chance
\`.often(fn)\` — 75% chance
\`.rarely(fn)\` — 25% chance
\`.almostAlways(fn)\` / \`.almostNever(fn)\` — 90%/10%
\`choose(a, b, c)\` — random pick per event
\`chooseCycles(a, b, c)\` — random pick per cycle

### Conditional
\`.every(n, fn)\` / \`.firstOf(n, fn)\` / \`.lastOf(n, fn)\` — apply fn every n cycles
\`.when(pat, fn)\` — apply fn when binary pattern is true
\`.chunk(n, fn)\` — rotate fn application across n subdivisions

### Accumulation
\`.superimpose(fn)\` — overlay transformed copy
\`.layer(fn1, fn2)\` — apply multiple functions
\`.off(time, fn)\` — delayed superimpose
\`.echo(times, time, feedback)\` — repeated echo
\`.echoWith(times, time, fn)\` — echo with transform

### Stacking Patterns
\`stack(pat1, pat2, pat3)\` — layer patterns
\`cat(pat1, pat2)\` — sequence one per cycle
Use \`$:\` prefix for multi-pattern live coding (named patterns):
\`$: s("bd sd")\`
\`$: s("hh*8").gain(0.5)\`

### Tempo
\`setcps(n)\` — set cycles per second (0.5 cps ≈ 120 BPM at 4 beats)
\`.cpm(n)\` — cycles per minute for a pattern
\`hush()\` — stop all sound immediately

### Useful Idioms
\`s("bd sd, hh*8").bank("RolandTR808")\` — basic beat
\`note("c3 [eb3 g3] c4 [g3 eb3]").s("sawtooth").lpf(800)\` — bass line
\`n(run(8)).scale("C:pentatonic").s("piano")\` — ascending scale
\`stack(drums, bass, melody)\` — layering parts
\`.sometimes(rev)\` — occasional reverse
\`.jux(rev)\` — stereo reverse
\`note("c3 e3 g3").off(1/8, x => x.add(7))\` — offset harmony
\`s("bd*4").echo(3, 1/8, 0.6)\` — echo buildup
\`note("0 2 4 6").scale("C:minor").superimpose(x => x.add(2).fast(2))\` — layered arpeggios
`;
