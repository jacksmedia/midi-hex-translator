const knownDurations = [
  1.0, 0.75, 0.5, 0.375, 0.33, 0.25,
  0.1875, 0.1667, 0.125, 0.083, 0.0625,
  0.0417, 0.0313, 0.0208, 0.0156
];

function decomposeDuration(total) {
  const tolerance = 0.01;
  const result = [];
  let remaining = total;

  while (remaining > tolerance) {
    const match = knownDurations.find(d => d <= remaining + tolerance);
    if (!match) break;
    result.push(match);
    remaining -= match;
  }

  return Math.abs(remaining) <= tolerance ? result : null;
}

function splitNoteName(name) {
  const match = name.match(/^([A-G]#?)(\d)$/);
  if (!match) return [name, null];
  return [match[1], parseInt(match[2], 10)];
}

function translateNotesToHex(notes, schema) {
  const hexOutput = [];
  let currentOctave = 4;

  for (const note of notes) {
    const name = note.name || 'REST';
    const [pitchClass, octave] = splitNoteName(name);
    const isNote = !!octave;

    if (isNote && octave !== currentOctave) {
      const diff = octave - currentOctave;
      const step = diff > 0 ? 'E1' : 'E2';
      for (let i = 0; i < Math.abs(diff); i++) hexOutput.push(step);
      currentOctave = octave;
    }

    const durations = decomposeDuration(note.duration);
    if (!durations) {
      console.warn(`❌ Unable to decompose duration: ${note.duration}`);
      hexOutput.push('??');
      continue;
    }

    durations.forEach((d, i) => {
      const durKey = d.toString();
      const noteKey = isNote ? `${pitchClass}4:${durKey}` : `${name}:${durKey}`;
      const schemaKey = i === 0 ? noteKey : `TIE:${durKey}`;
      const hex = schema[schemaKey];

      if (!hex) {
        console.warn(`❌ Unmatched schemaKey: ${schemaKey}`);
        hexOutput.push('??');
      } else {
        hexOutput.push(hex);
      }
    });
  }

  return hexOutput;
}

function translateTracksToHex(tracks, schema, gmToFfiv) {
  const activeTracks = tracks.filter(t => t.notes.length > 0);

  // Assign melodic instrument slots (max 13 total)
  const slotMap = {}; // gmNumber → slot index
  let nextSlot = 0;

  for (const track of activeTracks) {
    if (track.isPercussion) continue;
    if (!(track.gmNumber in slotMap) && nextSlot < 13) {
      slotMap[track.gmNumber] = nextSlot++;
    }
  }

  const hasPercussion = activeTracks.some(t => t.isPercussion);
  const percSlot = hasPercussion ? (nextSlot < 13 ? nextSlot++ : 12) : null;

  // Build instrument index (slot → FFIV ROM value)
  const instrumentIndex = [];
  for (const [gm, slot] of Object.entries(slotMap)) {
    instrumentIndex[slot] = gmToFfiv[parseInt(gm)];
  }
  if (percSlot !== null) {
    instrumentIndex[percSlot] = 0x0D; // Kick as percussion placeholder
  }

  const trackData = activeTracks.map(track => {
    const isPerc = track.isPercussion;
    const slot = isPerc ? percSlot : (slotMap[track.gmNumber] ?? 0);
    const ffivValue = isPerc ? 0x0D : gmToFfiv[track.gmNumber];

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

    const noteHex = translateNotesToHex(track.notes, schema);

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
// Track pointers in the song header are absolute SPC addresses, not relative offsets.
const SPC_BASE = 0x2000;

// LOOP_OFFSET: byte index within our generated track header where DA 04 sits.
// F4 loops here so the octave is reset to 4 before notes replay each iteration,
// preventing E1/E2 step bytes from compounding across loops.
// Header layout: F2(0) 00 00 C8 | F3(4) 00 00 80 | DB(8) XX | DE(10) 5F | EA/EB(12) | DA(13) 04
const LOOP_OFFSET = 13;

function assembleSPCSequence(tracks) {
  const MAX_TRACKS = 8;
  const activeTracks = tracks.slice(0, MAX_TRACKS);

  if (activeTracks.length > MAX_TRACKS) {
    console.warn(`⚠️ MIDI has ${tracks.length} tracks; only first ${MAX_TRACKS} included (FFIV engine limit).`);
  }

  // Calculate each track's start offset from song byte 02.
  // Song header is 18 bytes total; byte 02 is 2 bytes in, so tracks start 16 bytes (0x10) from byte 02.
  const trackOffsets = [];
  let offset = 0x10;
  for (const track of activeTracks) {
    trackOffsets.push(offset);
    offset += track.hex.length + 3; // +3 for appended F4 lo hi
  }

  // Build per-track hex arrays with F4 loop appended.
  const trackHexArrays = activeTracks.map((track, i) => {
    const loopTarget = trackOffsets[i] + LOOP_OFFSET;
    const lo = (loopTarget & 0xFF).toString(16).toUpperCase().padStart(2, '0');
    const hi = ((loopTarget >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
    return [...track.hex, 'F4', lo, hi];
  });

  // Total sequence length includes the 18-byte header itself.
  const trackTotalBytes = trackHexArrays.reduce((sum, arr) => sum + arr.length, 0);
  const totalLength = 18 + trackTotalBytes;

  // Build 18-byte song sequence header.
  const seqHeader = [];

  // Bytes 00–01: total length, little-endian.
  seqHeader.push((totalLength & 0xFF).toString(16).toUpperCase().padStart(2, '0'));
  seqHeader.push(((totalLength >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0'));

  // Bytes 02–17: 8 track pointers (2 bytes each, little-endian SPC address). Unused = 00 00.
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

  // Assemble and sanitise: replace any unresolved '??' with 00.
  return [...seqHeader, ...trackHexArrays.flat()].map(tok => {
    if (tok === '??') {
      console.warn('⚠️ Unmapped byte in sequence, substituting 00');
      return '00';
    }
    return tok;
  });
}

module.exports = { translateTracksToHex, assembleSPCSequence };
