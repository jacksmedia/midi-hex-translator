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

module.exports = { translateTracksToHex };
