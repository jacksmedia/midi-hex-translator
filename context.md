# FFIV SPC Music Hacking — Working Notes
> Based on "FFIV Music Hacking Guide" by Chillyfeez (Jan 2013)

---

## How a Song Is Structured in ROM

Two separate data regions:
- **Instrument Index:** `2420F`–`2490E` (one 32-byte block per song, 13 slots each)
- **SPC Sequences:** `3790E`–`43AB8` (one variable-length block per song)

These are **separate outputs** — our app must eventually produce both.

---

## Song Sequence Header (18 bytes, at start of each song's sequence block)

| Bytes | Meaning |
|-------|---------|
| 00–01 | Total sequence length, little-endian (includes itself) |
| 02–11 | Track pointers: 8 × 2 bytes, little-endian, in "XX 2X" format |

- First track pointer almost always `10 20` (data starts right after the 16-byte pointer table, i.e. offset 0x10 from byte 02)
- Unused track pointers = `00 00`
- "2X" prefix is a quirk of the engine — the address is relative to song byte 02, not 00

---

## Instrument Index (per song, at Instrument Data address)

- 13 instrument slots, each 1 byte, separated by `00` bytes
- Values `01`–`16` (see table below)
- Remaining slots filled with `00 00 00 00 00 00` (six zeroes at end)
- Total block = 32 bytes (two ROM lines)
- Example (The Prelude at 244AF): `04 00 01 00 07 00 00 00 ...` = Harp, Strings, Flute

### Instrument Values
| Hex | Instrument |
|-----|-----------|
| 01  | Strings (bowed) |
| 02  | Strings (plucked) |
| 03  | Grand Piano |
| 04  | Harp (title screen style) |
| 05  | Organ |
| 06  | Trumpet |
| 07  | Flute |
| 08  | Xylophone |
| 09  | Bass Guitar |
| 0A  | Timpani |
| 0B  | Electric Piano |
| 0C  | Snare Drum (low) |
| 0D  | Kick Drum |
| 0E  | Snare Drum (hard) |
| 0F  | Conga Drum |
| 10  | Cymbals (crash) |
| 11  | Hihat |
| 12  | Cowbell |
| 13  | Shaker |
| 14  | Whistle |
| 15  | Conga Drum (fuller) |
| 16  | Chocobo |

---

## Track Header Commands

Each track typically starts with a mini-header of commands before its notes.
Commands can also appear mid-track to change effects dynamically.

| Command | Params | Effect |
|---------|--------|--------|
| `DA XX` | 1 | Set octave. `00` = lowest. Range probably 0–7. |
| `DB XX` | 1 | **Set instrument.** `40` = first slot, `41` = second, etc. |
| `DE XX` | 1 | Set track volume (relative — only matters when multiple tracks). |
| `D4 XX` | 1 | "Multiple voice" effect — most notable on Organ (electric vs pipe). |
| `D5 XX YY` | 2 | Reverb. XX = level, YY = reverb-of-reverb. Careful with high YY. |
| `D2 XX YY ZZ` | 3 | Fade-in tempo. XX YY = rate (little-endian, higher = slower). ZZ = tempo (higher = faster). |
| `F2 00 00 ZZ` | 3 | Volume. Only ZZ has effect; XX YY always `00 00` in original. |
| `F3 00 00 ZZ` | 3 | Unknown, but present at start of every track. ZZ ranges ~50–C0, usually 80s. |
| `EA` or `EB` | 0 | Present before musical notation in every track. Exact purpose unclear. |

### Typical minimal track header:
```
EA          ; (or EB — present in all originals)
F3 00 00 80 ; unknown but standard
F2 00 00 XX ; volume
DA XX       ; set initial octave
DB 40       ; set instrument (40 = first slot in this song's instrument index)
DE XX       ; track relative volume
```

---

## Navigation / Control Commands

| Command | Params | Effect |
|---------|--------|--------|
| `E0 XX` | 1 | Loop start, repeat XX times |
| `F0` | 0 | Loop end (matches E0). Without E0, plays sustained C. |
| `E1` | 0 | **Octave up** (already implemented in translator) |
| `E2` | 0 | **Octave down** (already implemented in translator) |
| `F1` | 0 | Stop music |
| `F4 XX YY` | 2 | **Go to** (loop). XX YY = little-endian offset from song byte 02. Use to loop entire track. |
| `F6`+ | 0 | Stop music |
| `EC` | 0 | All subsequent notes play as static instead of tones |

---

## Instrument Assignment — How DB Works

- `DB 40` selects the 1st instrument in the song's instrument index block
- `DB 41` selects the 2nd instrument, etc.
- Using an unassigned slot → volume degrades, then silence
- Values below `40` → buzzsaw-like sounds (not usable for music)

**Implication for our app:**
- The song's instrument index is a separate 32-byte blob output to the ROM at the instrument data address
- Each track's sequence just references a slot by `DB 40+N`
- We need to collect the unique instruments used across all tracks, assign them slots 0–12, emit the index block separately, and have each track emit `DB 40+N`

---

## Song Sequence — F4 (Go To / Loop)

Format: `F4 XX YY` where `XX YY` is little-endian offset counted from song byte 02.

- First track always starts at byte offset `0x10` from byte 02 → pointer = `10 20`
- To loop the whole track back to its first note, calculate: (track start offset) + (track header length) = offset of first note
- Write `F4 [lo] [hi]` at end of each track

---

## What Our App Currently Outputs (Gaps)

1. ~~**All tracks merged into one flat byte stream**~~ ✓ — now per-track, returned as JSON array.
2. **No song sequence header** — the 18-byte header (length + track pointers) is not generated.
3. ~~**No track headers**~~ ✓ — F2, F3, DB, DE, EA/EB, DA 04 are now emitted per track.
4. **No F4 loop command** — tracks don't loop yet (two-pass offset calc needed).
5. **No instrument index block download** — blob is built server-side but not separately downloadable yet.
6. **E1/E2 are output as string literals**, not as the hex bytes 0xE1/0xE2 — this actually works fine since they ARE `E1`/`E2` in hex! The schema uses 2-char uppercase hex strings and so do these. This is correct behavior.

---

## Roadmap for Instrument Assignment Feature

### ~~Phase 1 — Per-track separation (server)~~ ✓
- `parser.js` returns per-track `{ trackIndex, gmNumber, gmName, isPercussion, notes[] }`
- `translator.js` accepts track array, assigns instrument slots, returns `{ tracks[], instrumentIndex[], slotCount }`
- `index.js` returns structured JSON; loads `gm-to-ffiv.json` for GM→FFIV mapping

### ~~Phase 2 — Track headers~~ ✓ (partial — no F4 yet)
- Each track's hex array begins with: `F2 00 00 C8 F3 00 00 80 DB [40+slot] DE 5F EA/EB DA 04`
- F4 loop command still pending (requires two-pass byte-length calculation)

### Phase 3 — Song sequence header
- Calculate per-track byte lengths
- Build 18-byte header: length (2 bytes) + 8 track pointers (2 bytes each)
- Prepend to assembled sequence

### Phase 4 — Instrument index block
- Collect unique instruments from all tracks (max 13)
- Build 32-byte instrument index: `[inst1] 00 [inst2] 00 ... 00 00 00 00 00 00`
- Output as separate blob alongside the sequence

### Phase 5 — UI
- Per-track panel: show track #, detected MIDI instrument name, dropdown to select FFIV instrument (01–16)
- "Download sequence" button → `.bin` of the sequence data (already done for flat output)
- "Download instrument index" button → 32-byte `.bin` blob

---

## ROM Analysis Results (from `ff2 v1.1 crc32=23084FCD.sfc`)

ROM is **unheadered** (1,048,576 bytes, evenly divisible by 512).
Subtract `0x200` from all addresses in Chillyfeez's guide (which assumes a headered ROM).

Verified against The Prelude instrument index at `0x242AF` (= `0x244AF - 0x200`):
reads `04 00 01 00 07 00 ...` exactly as the guide states. Offsets confirmed.

### EA vs EB — RESOLVED

Analyzed 4 songs (32 tracks). Pattern confirmed by cross-referencing instrument index:

| EB tracks found in | Instrument in that slot |
|--------------------|------------------------|
| Boss Music track 4 | Bass Guitar (09) |
| Boss Music track 8 | Hihat (11) |
| Overworld track 7  | Snare-hard (0E) |
| Overworld track 8  | Hihat (11) |

**Final Fantasy uses EA for ALL 8 tracks**, including Cymbals (10) and Timpani (0A).

**Conclusion:** EB = "no echo/reverb" for that channel. Used selectively for rhythmic/dry instruments where echo would muddy the sound. Not a hard rule (Cymbals use EA in some songs). EA is the safe default.

**App strategy:**
- Default **EA** for all generated tracks
- Auto-suggest **EB** for instruments: 09 (Bass Guitar), 0C (Snare-low), 0D (Kick), 0E (Snare-hard), 0F (Conga), 11 (Hihat), 12 (Cowbell), 13 (Shaker)
- Expose as a per-track toggle in the UI

### F3 — RESOLVED

F3 appears in virtually every track header with format `F3 00 00 ZZ`. ZZ values observed:

```
1E, 28, 3C, 46, 50, 5A, 64, 6E, 78, 80, 82, 8C, 91, 96, A0, B4, BE, C8, D2
```

These are multiples of ~0x0E (14) — i.e. `0x0E × N`. Range 0x1E–0xD2. Most common: `0x80` (128).

One unusual instance: The Prelude Track 1 has TWO F3 commands: `F3 00 00 3C` and `F3 80 01 C8`
(non-zero XX/YY in the second). This track also carries song-level D2/D4/D5 commands — it's the "conductor" track. Not a pattern for normal track headers.

**App default: `F3 00 00 80`** for all generated track headers. Make it a configurable hex field per track in the UI later.

### DA (Set Octave) — RESOLVED

Values observed across all tracks: **02, 03, 04, 05**. Most common: 03 and 04.

The SPC engine's "octave N" maps to our MIDI octave N. DA 04 = MIDI octave 4 = our schema base.
Our translator already starts `currentOctave = 4` and emits E1/E2 from there.

**App strategy: always emit `DA 04`** in each track header. The E1/E2 logic in `translator.js` handles all octave adjustments correctly from that baseline — no changes to translator logic needed.

### D8 — NEW OBSERVATION

`D8 XX 32 14` appears in most (but not all) track headers. Second and third params are almost always `32 14`. First param varies (46, 48, 4B, 60, 62, 64, 6E, 78...).

Almost certainly ADSR envelope data for the SPC700 DSP. The guide says "no discernible effect" — safe to **omit from generated headers** for now. Can add later if attack/decay tuning becomes important.

### Confirmed Minimal Track Header Template

Based on ROM analysis, a working generated track header should be:

```
F2 00 00 C8    ; volume (ZZ=0xC8 is a solid default; 0xFF is max)
F3 00 00 80    ; unknown but required; ZZ=0x80 is most common
DB 40          ; set instrument (40 + slot index)
DE 5F          ; track relative volume (0x5F = 95, seen in every original track)
EA             ; echo on (use EB for dry percussion instruments)
DA 04          ; set octave to 4 (our schema base)
[notes begin]
```

DC/DD (transpose) appears in all original headers but its effect is unclear; **omit for now**.
D5 (reverb), D4 (multi voice), D2 (fade tempo) are song-level, placed only in Track 1.

---

## New Files (this feature)

- `translation-schemas/gm-to-ffiv.json`: 128-element array, index = GM program number, value = FFIV ROM instrument byte (1–22 decimal). Hand-crafted by instrument family.

## Open Questions (Remaining)

1. **Track volume (DE / F2 ZZ)** — DE is `5F` (95) in almost every original track. F2 ZZ varies. A reasonable approach: map MIDI velocity average → F2 ZZ; use `DE 5F` as a fixed default.
2. **DC/DD (transpose)** — purpose still unknown; safely omitted.
3. ~~**@tonejs/midi instrument data**~~ ✓ — `track.instrument.number` (GM 0–127), `track.instrument.name`, `track.instrument.percussion`, `track.channel` (9 = percussion). All available without a test script.
4. **F4 loop offsets** — requires knowing each track's byte length before patching in the loop target. Two-pass approach needed: serialize all tracks → compute offsets → patch F4 bytes.
5. **Percussion instrument granularity** — GM channel 10 uses note pitch to select drum sound; currently all percussion tracks share one slot (Kick, 0D) as a placeholder. True mapping needs per-note GM drum → FFIV instrument splitting into virtual tracks.
