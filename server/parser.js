const fs = require('fs');
const { Midi } = require('@tonejs/midi');

async function parseMidiToEvents(input) {
  const data = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const midi = new Midi(data);

  const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
  const tempos = midi.header.tempos.map(t => ({ bpm: t.bpm, time: t.time }));

  const tracks = midi.tracks.map((track, trackIndex) => {
    const isPercussion = track.channel === 9 || track.instrument?.percussion === true;

    return {
      trackIndex,
      channel: track.channel ?? null,
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

  return { tracks, bpm, tempos };
}

module.exports = { parseMidiToEvents };
