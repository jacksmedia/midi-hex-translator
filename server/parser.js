const fs = require('fs');
const { Midi } = require('@tonejs/midi');

async function parseMidiToEvents(filepath) {
  const data = fs.readFileSync(filepath);
  const midi = new Midi(data);

  return midi.tracks.map((track, trackIndex) => {
    const isPercussion = track.channel === 9 || track.instrument?.percussion === true;

    return {
      trackIndex,
      gmNumber: track.instrument?.number ?? 0,
      gmName: track.instrument?.name ?? 'acoustic grand piano',
      isPercussion,
      notes: track.notes.map(note => ({
        time: note.time,
        midi: note.midi,
        duration: note.duration,
        velocity: note.velocity,
        name: note.name
      }))
    };
  });
}

module.exports = { parseMidiToEvents };
