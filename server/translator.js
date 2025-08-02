function snapDuration(duration) {
  const known = [
    1.0, 0.75, 0.5, 0.375, 0.33, 0.25,
    0.1875, 0.1667, 0.125, 0.083, 0.0625,
    0.0417, 0.0313, 0.0208, 0.0156
  ];
  const snapped = known.find(d => Math.abs(d - duration) < 0.01);
  return snapped?.toString() || null;
}

// Extract pitch class and octave from a note like "A#2"
function splitNoteName(name) {
  const match = name.match(/^([A-G]#?)(\d)$/);
  if (!match) return [name, null]; // REST, TIE, etc.
  return [match[1], parseInt(match[2], 10)];
}

function translateEventsToFlatHex(events, schema) {
  const hexOutput = [];
  let currentOctave = 4; // SNES schema is defined at octave 4

  for (const evt of events) {
    let name = evt.name || "REST";
    const duration = snapDuration(evt.duration);
    if (!duration) {
      console.warn(`⚠️ Duration snapping failed for: ${evt.duration}`);
      hexOutput.push("??");
      continue;
    }

    const [pitchClass, octave] = splitNoteName(name);

    // Skip control names like REST/TIE
    const isNote = !!octave;

    // Inject E1/E2 if needed to change octave
    if (isNote && octave !== currentOctave) {
      const diff = octave - currentOctave;
      const dir = Math.sign(diff);
      const step = dir === 1 ? "E1" : "E2";

      for (let i = 0; i < Math.abs(diff); i++) {
        hexOutput.push(step);
      }
      currentOctave = octave;
    }

    // Final lookup using fixed octave 4 as schema base
    const schemaKey = isNote ? `${pitchClass}4:${duration}` : `${name}:${duration}`;
    const hex = schema[schemaKey];

    if (!hex) {
      console.warn(`⚠️ Unmatched event → key: "${schemaKey}"`);
      hexOutput.push("??");
    } else {
      hexOutput.push(hex);
    }
  }

  return hexOutput;
}

module.exports = { translateEventsToFlatHex };
