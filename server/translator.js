// ─── Duration Table ───────────────────────────────────────────────────────────
// 15 entries matching the Chillyfeez FFIVMHG-8 table rows, in beats
// (quarter note = 1 beat).  Byte = noteIndex * 15 + durationIndex.
// NOTE: indices 3↔4 and 6↔7 were swapped in the previous build — corrected here.
const DURATION_TABLE = [
  4,      // 0: 1/1   whole
  3,      // 1: 3/4   dotted half
  2,      // 2: 1/2   half
  1.5,    // 3: 3/8   dotted quarter
  4 / 3,  // 4: 1/3   triplet half
  1,      // 5: 1/4   quarter
  0.75,   // 6: 3/16  dotted eighth
  2 / 3,  // 7: 1/6   triplet quarter
  0.5,    // 8: 1/8   eighth
  1 / 3,  // 9: 1/12  triplet eighth
  0.25,   // 10: 1/16 sixteenth
  1 / 6,  // 11: 1/24 triplet sixteenth
  0.125,  // 12: 1/32 thirty-second
  1 / 12, // 13: 1/48 triplet thirty-second
  0.0625  // 14: 1/64 sixty-fourth
];

const NOTE_MAP = {
  'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4,
  'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
};
const REST_INDEX = 12;
const TIE_INDEX  = 13;

// SPC RAM base address where FFIV loads the song sequence.
const SPC_BASE = 0x2000;

// Byte offset of the DA 04 (set octave 4) command within a track header.
// F4 loop-back targets this so the octave resets to 4 on each repeat.
// Header layout: F2(0) 00 00 C8 | F3(4) 00 00 80 | DB(8) XX | DE(10) 5F | EA/EB(12) | DA(13) 04
const LOOP_OFFSET = 13;

// ─── Utilities ────────────────────────────────────────────────────────────────

function hex(n) {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

function splitNoteName(name) {
  const m = name.match(/^([A-G]#?)(\d)$/);
  return m ? [m[1], parseInt(m[2], 10)] : [name, null];
}

// ─── Tempo lookup ─────────────────────────────────────────────────────────────

function bpmAtTime(tempos, time) {
  let active = tempos.length > 0 ? tempos[0].bpm : 120;
  for (const t of tempos) {
    if (t.time <= time) active = t.bpm;
    else break;
  }
  return active;
}

// ─── Duration decomposition ───────────────────────────────────────────────────
// Greedy: picks the largest duration that fits, chains ties for remainders.
// Returns array of DURATION_TABLE indices, or null if total error exceeds tolerance.

function decomposeDuration(beats) {
  const TOLERANCE = 0.03;
  const indices = [];
  let remaining = beats;

  while (remaining > TOLERANCE) {
    const idx = DURATION_TABLE.findIndex(d => d <= remaining + TOLERANCE);
    if (idx === -1) break;
    indices.push(idx);
    remaining -= DURATION_TABLE[idx];
  }

  return Math.abs(remaining) <= TOLERANCE ? indices : null;
}

// ─── Rest insertion ───────────────────────────────────────────────────────────
// Converts parser note objects (time in seconds, duration in seconds) into a
// flat event list with durationBeats, inserting REST events for gaps.

function insertRests(notes, tempos) {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const events = [];
  let cursor = 0; // seconds

  for (const note of sorted) {
    const gap = note.time - cursor;
    if (gap > 0.01) {
      const spb = 60 / bpmAtTime(tempos, cursor);
      events.push({ name: 'REST', durationBeats: gap / spb });
    }
    const spb = 60 / bpmAtTime(tempos, note.time);
    events.push({ ...note, durationBeats: note.duration / spb });
    cursor = Math.max(cursor, note.time + note.duration);
  }

  return events;
}

// ─── Event encoder ────────────────────────────────────────────────────────────
// Converts a prepared event list ({name, durationBeats}) into SPC hex tokens
// plus E1/E2 octave shift commands.  Returns tokens and any warnings.

function encodeEvents(events) {
  const tokens = [];
  const warnings = [];
  let currentOctave = 4;

  for (const ev of events) {
    const name = ev.name || 'REST';
    const [pitchClass, octave] = splitNoteName(name);
    const isNote = octave !== null;

    if (isNote && octave !== currentOctave) {
      const diff = octave - currentOctave;
      const cmd = diff > 0 ? 'E1' : 'E2';
      for (let i = 0; i < Math.abs(diff); i++) tokens.push(cmd);
      currentOctave = octave;
    }

    const durIndices = decomposeDuration(ev.durationBeats);
    if (!durIndices || durIndices.length === 0) {
      warnings.push(`Cannot encode ${ev.durationBeats.toFixed(4)} beats for "${name}" — event skipped`);
      continue;
    }

    const baseIdx = isNote
      ? (NOTE_MAP[pitchClass] ?? -1)
      : (name === 'TIE' ? TIE_INDEX : REST_INDEX);

    if (baseIdx < 0) {
      warnings.push(`Unknown pitch class "${pitchClass}" — event skipped`);
      continue;
    }

    // First duration index uses the note/rest; subsequent indices use TIE.
    durIndices.forEach((durIdx, i) => {
      tokens.push(hex((i === 0 ? baseIdx : TIE_INDEX) * 15 + durIdx));
    });
  }

  return { tokens, warnings };
}

// ─── Percussion expansion ─────────────────────────────────────────────────────
// Splits a GM percussion track into one virtual track per FFIV drum instrument.
// Each virtual track is a timeline of C4 hits (same pitch, FFIV differentiates
// by instrument slot) with REST events for the gaps between hits.

const DRUM_HIT_BEATS = 0.25; // sixteenth note — all hits fixed at this duration

const FFIV_DRUM_NAMES = {
  8:  'Xylophone',   10: 'Timpani',      12: 'Snare low',
  13: 'Kick',        14: 'Snare hard',   15: 'Conga',
  16: 'Cymbals',     17: 'Hihat',        18: 'Cowbell',
  19: 'Shaker',      20: 'Whistle',      21: 'Conga fuller'
};

function expandPercussionTrack(track, gmDrumMap, tempos) {
  const groups = {};
  for (const note of track.notes) {
    const ffivValue = gmDrumMap[note.midi] ?? 13;
    if (!groups[ffivValue]) groups[ffivValue] = [];
    groups[ffivValue].push(note);
  }

  return Object.entries(groups).map(([ffivValueStr, notes]) => {
    const ffivValue = parseInt(ffivValueStr, 10);
    const sorted = [...notes].sort((a, b) => a.time - b.time);

    const events = [];
    let cursor = 0;

    for (const note of sorted) {
      const gap = note.time - cursor;
      if (gap > 0.01) {
        const spb = 60 / bpmAtTime(tempos, cursor);
        events.push({ name: 'REST', durationBeats: gap / spb });
      }
      events.push({ name: 'C4', durationBeats: DRUM_HIT_BEATS });
      const spb = 60 / bpmAtTime(tempos, note.time);
      cursor = note.time + (DRUM_HIT_BEATS * spb);
    }

    return {
      trackIndex: track.trackIndex,
      gmNumber: -1,
      gmName: FFIV_DRUM_NAMES[ffivValue] ?? `Drum-${hex(ffivValue)}`,
      isPercussion: true,
      ffivValue,
      notes: events // already in {name, durationBeats} form
    };
  });
}

// ─── Track header ─────────────────────────────────────────────────────────────
// Produces the 15-byte preamble placed before note data in every track.

function buildTrackHeader(slot, isPercussion) {
  return [
    'F2', '00', '00', 'C8',          // volume (C8 = 200)
    'F3', '00', '00', '80',          // required; ZZ=0x80 default
    'DB', hex(0x40 + slot),          // set instrument slot
    'DE', '5F',                      // relative track volume
    isPercussion ? 'EB' : 'EA',      // EB=echo off (dry perc), EA=echo on
    'DA', '04'                       // set octave 4 (translator baseline)
  ];
}

// ─── Track translation ────────────────────────────────────────────────────────

function translateTracksToHex(tracks, _schema, gmToFfiv, gmDrumMap, bpm, tempos = [{ bpm, time: 0 }]) {
  // Expand percussion; drop empty tracks.
  const activeTracks = [];
  for (const track of tracks) {
    if (track.notes.length === 0) continue;
    if (track.isPercussion) {
      activeTracks.push(...expandPercussionTrack(track, gmDrumMap, tempos));
    } else {
      activeTracks.push(track);
    }
  }

  // Assign instrument slots (max 13): melodic keyed by GM number, drums by FFIV value.
  const melodicSlotMap = {};
  const drumSlotMap = {};
  let nextSlot = 0;

  for (const track of activeTracks) {
    if (!track.isPercussion) {
      if (!(track.gmNumber in melodicSlotMap) && nextSlot < 13) {
        melodicSlotMap[track.gmNumber] = nextSlot++;
      }
    } else {
      if (!(track.ffivValue in drumSlotMap) && nextSlot < 13) {
        drumSlotMap[track.ffivValue] = nextSlot++;
      }
    }
  }

  // Build instrument index array (slot → FFIV ROM value).
  const instrumentIndex = [];
  for (const [gm, slot] of Object.entries(melodicSlotMap)) {
    instrumentIndex[slot] = gmToFfiv[parseInt(gm, 10)];
  }
  for (const [ffivVal, slot] of Object.entries(drumSlotMap)) {
    instrumentIndex[slot] = parseInt(ffivVal, 10);
  }

  const allWarnings = [];

  const trackData = activeTracks.map(track => {
    const isPerc = track.isPercussion;
    const slot = isPerc
      ? (drumSlotMap[track.ffivValue] ?? 0)
      : (melodicSlotMap[track.gmNumber] ?? 0);
    const ffivValue = isPerc ? track.ffivValue : gmToFfiv[track.gmNumber];

    const header = buildTrackHeader(slot, isPerc);

    // Percussion tracks already have {name, durationBeats} from expandPercussionTrack.
    // Melodic tracks need rest insertion and seconds→beats conversion.
    const events = isPerc
      ? track.notes
      : insertRests(track.notes, tempos);

    const { tokens: noteTokens, warnings } = encodeEvents(events);

    if (warnings.length > 0) {
      console.warn(`Track ${track.trackIndex} "${track.gmName}":`, warnings);
      allWarnings.push(...warnings.map(w => `[${track.gmName}] ${w}`));
    }

    return {
      trackIndex: track.trackIndex,
      gmNumber:   track.gmNumber,
      gmName:     track.gmName,
      ffivInstrument: hex(ffivValue ?? 0),
      isPercussion:   isPerc,
      slot,
      hex: [...header, ...noteTokens]
    };
  });

  return {
    tracks: trackData,
    instrumentIndex: instrumentIndex.map(v => hex(v ?? 0)),
    slotCount: nextSlot,
    warnings: allWarnings
  };
}

// ─── Song sequence assembly ───────────────────────────────────────────────────
// Builds the 18-byte song header + all track data with correct F4 loop pointers.
// F4 XX YY: little-endian SPC address = SPC_BASE + offset_from_song_byte02.

function assembleSPCSequence(tracks) {
  const MAX_VOICES = 8;
  const active = tracks.slice(0, MAX_VOICES);

  if (tracks.length > MAX_VOICES) {
    console.warn(`${tracks.length} tracks provided; only first ${MAX_VOICES} written (FFIV engine limit).`);
  }

  // Compute each track's start offset (counted from song byte 02).
  // First track immediately follows the 16-byte pointer table → offset 0x10.
  const offsets = [];
  let offset = 0x10;
  for (const track of active) {
    offsets.push(offset);
    offset += track.hex.length + 3; // +3 for the F4 lo hi appended below
  }

  // Append F4 loop-back to each track.
  // Target = SPC_BASE + track_start_offset + LOOP_OFFSET (points to DA 04).
  const builtTracks = active.map((track, i) => {
    const target = SPC_BASE + offsets[i] + LOOP_OFFSET;
    return [...track.hex, 'F4', hex(target & 0xFF), hex((target >> 8) & 0xFF)];
  });

  const trackByteCount = builtTracks.reduce((sum, t) => sum + t.length, 0);
  const totalLength = 18 + trackByteCount; // 18-byte header + all track data

  // Song header: 2-byte total length (little-endian) + 8×2-byte track pointers.
  const header = [
    hex(totalLength & 0xFF),
    hex((totalLength >> 8) & 0xFF)
  ];

  for (let i = 0; i < 8; i++) {
    if (i < active.length) {
      const ptr = SPC_BASE + offsets[i];
      header.push(hex(ptr & 0xFF), hex((ptr >> 8) & 0xFF));
    } else {
      header.push('00', '00');
    }
  }

  return [...header, ...builtTracks.flat()];
}

module.exports = { translateTracksToHex, assembleSPCSequence };
