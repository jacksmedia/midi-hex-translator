// Duration table in beats (quarter note = 1 beat).
// Matches the N-SPC engine used by FFIV/FFV, verified against Luke's FF5Reader.
// byte = noteIndex * 15 + durationIndex
const DURATION_TABLE = [
  4,       // 0: whole note
  3,       // 1: dotted half
  2,       // 2: half note
  4/3,     // 3: triplet half
  1.5,     // 4: dotted quarter
  1,       // 5: quarter note
  2/3,     // 6: triplet quarter
  0.75,    // 7: dotted eighth
  0.5,     // 8: eighth note
  1/3,     // 9: triplet eighth
  0.25,    // 10: sixteenth
  0.5/3,   // 11: triplet sixteenth
  0.125,   // 12: thirty-second
  0.25/3,  // 13: triplet thirty-second
  0.0625   // 14: sixty-fourth
];

const NOTE_MAP = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
const REST_INDEX = 12;
const TIE_INDEX  = 13;

function byteToHex(b) {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

function splitNoteName(name) {
  const match = name.match(/^([A-G]#?)(\d)$/);
  if (!match) return [name, null];
  return [match[1], parseInt(match[2], 10)];
}

// Greedy decomposition of a beat duration into SPC duration-table entries.
// Returns array of duration indices, or null if decomposition fails.
function decomposeDuration(totalBeats) {
  const tolerance = 0.03;
  const result = [];
  let remaining = totalBeats;

  while (remaining > tolerance) {
    const idx = DURATION_TABLE.findIndex(d => d <= remaining + tolerance);
    if (idx === -1) break;
    result.push(idx);
    remaining -= DURATION_TABLE[idx];
  }

  return Math.abs(remaining) <= tolerance ? result : null;
}

// Insert REST events for time gaps between melodic notes.
// Converts durations from seconds to beats.
function insertRests(notes, secondsPerBeat) {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const result = [];
  let cursor = 0; // seconds

  for (const note of sorted) {
    const gap = note.time - cursor;
    if (gap > 0.01) {
      result.push({ name: 'REST', durationBeats: gap / secondsPerBeat });
    }
    result.push({ ...note, durationBeats: note.duration / secondsPerBeat });
    cursor = Math.max(cursor, note.time + note.duration);
  }
  return result;
}

function translateNotesToHex(preparedNotes) {
  const hexOutput = [];
  let currentOctave = 4;

  for (const note of preparedNotes) {
    const name = note.name || 'REST';
    const [pitchClass, octave] = splitNoteName(name);
    const isNote = octave !== null;

    if (isNote && octave !== currentOctave) {
      const diff = octave - currentOctave;
      const step = diff > 0 ? 'E1' : 'E2';
      for (let j = 0; j < Math.abs(diff); j++) hexOutput.push(step);
      currentOctave = octave;
    }

    const durIndices = decomposeDuration(note.durationBeats);
    if (!durIndices || durIndices.length === 0) {
      console.warn(`Unable to decompose duration: ${note.durationBeats.toFixed(4)} beats (${name})`);
      hexOutput.push('??');
      continue;
    }

    const baseIdx = isNote ? (NOTE_MAP[pitchClass] ?? -1) : (name === 'TIE' ? TIE_INDEX : REST_INDEX);
    if (baseIdx < 0) {
      console.warn(`Unknown pitch class: ${pitchClass}`);
      hexOutput.push('??');
      continue;
    }

    durIndices.forEach((durIdx, i) => {
      const noteIdx = i === 0 ? baseIdx : TIE_INDEX;
      hexOutput.push(byteToHex(noteIdx * 15 + durIdx));
    });
  }

  return hexOutput;
}

// E0/F0 loop compression.
// Scans note hex for consecutive repeating patterns and wraps them in
// E0 XX [pattern] F0  (plays the block XX+1 times total).
function compressWithLoops(hexArray) {
  const MAX_PAT_LEN = 256;
  const result = [];
  let i = 0;

  while (i < hexArray.length) {
    let bestLen = 0;
    let bestCount = 0;
    let bestSavings = 0;

    const maxLen = Math.min(MAX_PAT_LEN, Math.floor((hexArray.length - i) / 2));

    for (let len = 1; len <= maxLen; len++) {
      // Count consecutive repeats of this pattern.
      let count = 1;
      const maxCount = Math.min(256, Math.floor((hexArray.length - i) / len));
      for (let c = 1; c < maxCount; c++) {
        let match = true;
        for (let k = 0; k < len; k++) {
          if (hexArray[i + len * c + k] !== hexArray[i + k]) { match = false; break; }
        }
        if (!match) break;
        count++;
      }

      if (count < 2) continue;

      // savings = bytes removed - bytes added (E0 XX … F0 = 3 extra bytes)
      const savings = len * (count - 1) - 3;
      if (savings > bestSavings) {
        bestSavings = savings;
        bestLen = len;
        bestCount = count;
      }
    }

    if (bestSavings > 0) {
      result.push('E0', byteToHex(bestCount - 1));
      for (let k = 0; k < bestLen; k++) result.push(hexArray[i + k]);
      result.push('F0');
      i += bestLen * bestCount;
    } else {
      result.push(hexArray[i]);
      i++;
    }
  }

  return result;
}

// All drum hits mapped to C4 at a fixed short duration.
const DRUM_HIT_BEATS = 0.25; // sixteenth note

const FFIV_DRUM_NAMES = {
  8: 'Xylophone', 10: 'Timpani', 12: 'Snare low', 13: 'Kick',
  14: 'Snare hard', 15: 'Conga', 16: 'Cymbals', 17: 'Hihat',
  18: 'Cowbell', 19: 'Shaker', 20: 'Whistle', 21: 'Conga fuller'
};

function expandPercussionTrack(track, gmDrumMap, secondsPerBeat) {
  const groups = {};

  for (const note of track.notes) {
    const ffivValue = gmDrumMap[note.midi] ?? 13;
    if (!groups[ffivValue]) groups[ffivValue] = [];
    groups[ffivValue].push(note);
  }

  return Object.entries(groups).map(([ffivValueStr, notes]) => {
    const ffivValue = parseInt(ffivValueStr);
    const sorted = [...notes].sort((a, b) => a.time - b.time);

    const virtualNotes = [];
    let cursor = 0; // seconds

    for (const note of sorted) {
      const gap = note.time - cursor;
      if (gap > 0.01) {
        virtualNotes.push({ name: 'REST', durationBeats: gap / secondsPerBeat });
      }
      virtualNotes.push({ name: 'C4', durationBeats: DRUM_HIT_BEATS });
      cursor = note.time + (DRUM_HIT_BEATS * secondsPerBeat);
    }

    return {
      trackIndex: track.trackIndex,
      gmNumber: -1,
      gmName: FFIV_DRUM_NAMES[ffivValue] ?? `drum-${ffivValue.toString(16).toUpperCase()}`,
      isPercussion: true,
      ffivValue,
      notes: virtualNotes
    };
  });
}

function translateTracksToHex(tracks, schema, gmToFfiv, gmDrumMap, bpm) {
  const secondsPerBeat = 60 / bpm;

  const activeTracks = [];
  for (const track of tracks) {
    if (track.notes.length === 0) continue;
    if (track.isPercussion) {
      activeTracks.push(...expandPercussionTrack(track, gmDrumMap, secondsPerBeat));
    } else {
      activeTracks.push(track);
    }
  }

  // Assign slots: melodic by gmNumber, drums by ffivValue.
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

  // Build instrument index (slot -> FFIV ROM value).
  const instrumentIndex = [];
  for (const [gm, slot] of Object.entries(melodicSlotMap)) {
    instrumentIndex[slot] = gmToFfiv[parseInt(gm)];
  }
  for (const [ffivVal, slot] of Object.entries(drumSlotMap)) {
    instrumentIndex[slot] = parseInt(ffivVal);
  }

  const trackData = activeTracks.map(track => {
    const isPerc = track.isPercussion;
    const slot = isPerc
      ? (drumSlotMap[track.ffivValue] ?? 0)
      : (melodicSlotMap[track.gmNumber] ?? 0);
    const ffivValue = isPerc ? track.ffivValue : gmToFfiv[track.gmNumber];

    const dbByte = (0x40 + slot).toString(16).toUpperCase().padStart(2, '0');
    const echoCmd = isPerc ? 'EB' : 'EA';

    const header = [
      'F2', '00', '00', 'C8',
      'F3', '00', '00', '80',
      'DB', dbByte,
      'DE', '5F',
      echoCmd,
      'DA', '04'
    ];

    // Melodic tracks: insert rests and convert seconds->beats.
    // Percussion tracks: already have durationBeats from expandPercussionTrack.
    const preparedNotes = isPerc
      ? track.notes
      : insertRests(track.notes, secondsPerBeat);

    const noteHex = compressWithLoops(translateNotesToHex(preparedNotes));

    return {
      trackIndex: track.trackIndex,
      gmNumber: track.gmNumber,
      gmName: track.gmName,
      ffivInstrument: ffivValue.toString(16).toUpperCase().padStart(2, '0'),
      isPercussion: isPerc,
      slot,
      hex: [...header, ...noteHex]
    };
  });

  return {
    tracks: trackData,
    instrumentIndex: instrumentIndex.map(v => (v ?? 0).toString(16).toUpperCase().padStart(2, '0')),
    slotCount: nextSlot
  };
}

// SPC_BASE: SPC RAM address where song data is loaded by the FFIV engine.
const SPC_BASE = 0x2000;

// LOOP_OFFSET: byte index within track header where DA 04 sits.
// F4 loops here so octave resets to 4 before notes replay.
// Header: F2(0) 00 00 C8 | F3(4) 00 00 80 | DB(8) XX | DE(10) 5F | EA/EB(12) | DA(13) 04
const LOOP_OFFSET = 13;

function assembleSPCSequence(tracks) {
  const MAX_TRACKS = 8;
  const activeTracks = tracks.slice(0, MAX_TRACKS);

  if (tracks.length > MAX_TRACKS) {
    console.warn(`MIDI has ${tracks.length} tracks; only first ${MAX_TRACKS} included (FFIV engine limit).`);
  }

  const trackOffsets = [];
  let offset = 0x10;
  for (const track of activeTracks) {
    trackOffsets.push(offset);
    offset += track.hex.length + 3; // +3 for appended F4 lo hi
  }

  const trackHexArrays = activeTracks.map((track, i) => {
    const loopTarget = trackOffsets[i] + LOOP_OFFSET;
    const lo = (loopTarget & 0xFF).toString(16).toUpperCase().padStart(2, '0');
    const hi = ((loopTarget >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
    return [...track.hex, 'F4', lo, hi];
  });

  const trackTotalBytes = trackHexArrays.reduce((sum, arr) => sum + arr.length, 0);
  const totalLength = 18 + trackTotalBytes;

  const seqHeader = [];
  seqHeader.push((totalLength & 0xFF).toString(16).toUpperCase().padStart(2, '0'));
  seqHeader.push(((totalLength >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0'));

  for (let i = 0; i < 8; i++) {
    if (i < activeTracks.length) {
      const ptr = SPC_BASE + trackOffsets[i];
      seqHeader.push((ptr & 0xFF).toString(16).toUpperCase().padStart(2, '0'));
      seqHeader.push(((ptr >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0'));
    } else {
      seqHeader.push('00');
      seqHeader.push('00');
    }
  }

  return [...seqHeader, ...trackHexArrays.flat()].map(tok => {
    if (tok === '??') {
      console.warn('Unmapped byte in sequence, substituting 00');
      return '00';
    }
    return tok;
  });
}

module.exports = { translateTracksToHex, assembleSPCSequence, expandPercussionTrack, compressWithLoops };
