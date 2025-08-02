const knownDurations  = [
  1.0, 0.75, 0.5, 0.375, 0.33, 0.25,
  0.1875, 0.1667, 0.125, 0.083, 0.0625,
  0.0417, 0.0313, 0.0208, 0.0156
];

// function snapDuration(duration) {
//   const snapped = known.find(d => Math.abs(d - duration) < 0.06);
//   return snapped?.toString() || null;
// }

function decomposeDuration(total) { // needed for notes longer than 1.0
  const tolerance = 0.01;
  const result = [];

  let remaining = total;

  while (remaining > tolerance) {
    const match = knownDurations.find(d => d <= remaining + tolerance);
    if (!match) break; // no fit, exit loop
    result.push(match);
    remaining -= match;
  }

  const leftover = Math.abs(remaining);
  return leftover <= tolerance ? result : null;
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
    // const duration = snapDuration(evt.duration);
    // if (!duration) {
    //   const closest = knownDurations.reduce((a, b) =>
    //     Math.abs(b - evt.duration) < Math.abs(a - evt.duration) ? b : a
    //   );
    //   console.warn(`⚠️ Duration snapping failed for: ${evt.duration} → closest: ${closest}`);
    // }

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

    const durations = decomposeDuration(evt.duration);
    if (!durations) {
      console.warn(`❌ Unable to decompose duration: ${evt.duration}`);
      hexOutput.push("??");
      continue;
    }

    durations.forEach((d, i) => {
      const durKey = d.toString();
      const noteKey = isNote
        ? `${pitchClass}4:${durKey}`
        : `${name}:${durKey}`;

      const schemaKey = i === 0 ? noteKey : `TIE:${durKey}`;
      const hex = schema[schemaKey];

      if (!hex) {
        console.warn(`❌ Unmatched schemaKey: ${schemaKey}`);
        hexOutput.push("??");
      } else {
        hexOutput.push(hex);
      }
    });

    // Final lookup using fixed octave 4 as schema base
    // const schemaKey = isNote ? `${pitchClass}4:${duration}` : `${name}:${duration}`;
    // const hex = schema[schemaKey];

    // if (!hex) {
    //   console.warn(`⚠️ Unmatched event → key: "${schemaKey}"`);
    //   hexOutput.push("??");
    // } else {
    //   hexOutput.push(hex);
    // }
  }

  return hexOutput;
}

module.exports = { translateEventsToFlatHex };