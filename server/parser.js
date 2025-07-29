const fs = require('fs');
const { Midi } = require('@tonejs/midi');

async function parseMidiToEvents(filepath) {
  const data = fs.readFileSync(filepath);
  const midi = new Midi(data);

  const parsed = [];

  midi.tracks.forEach((track, trackIndex) => {
    track.notes.forEach(note => {
      parsed.push({
        track: trackIndex,
        time: note.time,
        midi: note.midi,
        duration: note.duration,
        velocity: note.velocity,
        name: note.name
      });
    });
  });

  return parsed;
}

module.exports = { parseMidiToEvents };
