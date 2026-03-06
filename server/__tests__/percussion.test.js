'use strict';

const { expandPercussionTrack } = require('../translator');
const gmDrumMap = require('../../translation-schemas/gm-drums.json');

// GM note numbers used in tests (from gm-drums.json):
// 36 → 13 (Kick), 38 → 12 (Snare low), 42 → 17 (Hihat), 49 → 16 (Cymbals)

function makeTrack(notes) {
  return { trackIndex: 1, notes };
}

describe('expandPercussionTrack', () => {
  test('groups repeated hits of the same type into one virtual track', () => {
    const track = makeTrack([
      { midi: 36, time: 0,   duration: 0.1 }, // Kick
      { midi: 36, time: 0.5, duration: 0.1 }, // Kick again — same group
      { midi: 38, time: 1.0, duration: 0.1 }, // Snare — different group
    ]);
    const result = expandPercussionTrack(track, gmDrumMap);
    expect(result).toHaveLength(2); // Kick + Snare, NOT 3 tracks
  });

  test('four distinct drum types produce four virtual tracks', () => {
    const track = makeTrack([
      { midi: 36, time: 0,   duration: 0.1 }, // Kick
      { midi: 38, time: 0.5, duration: 0.1 }, // Snare
      { midi: 42, time: 1.0, duration: 0.1 }, // Hihat
      { midi: 49, time: 1.5, duration: 0.1 }, // Cymbals
    ]);
    const result = expandPercussionTrack(track, gmDrumMap);
    expect(result).toHaveLength(4);
  });

  test('each virtual track interleaves REST and C4 hit notes', () => {
    const track = makeTrack([
      { midi: 36, time: 0.5, duration: 0.1 },
      { midi: 36, time: 1.5, duration: 0.1 },
    ]);
    const [kickTrack] = expandPercussionTrack(track, gmDrumMap);
    // Pattern: REST, C4, REST, C4
    expect(kickTrack.notes[0]).toMatchObject({ name: 'REST' });
    expect(kickTrack.notes[1]).toMatchObject({ name: 'C4' });
    expect(kickTrack.notes[2]).toMatchObject({ name: 'REST' });
    expect(kickTrack.notes[3]).toMatchObject({ name: 'C4' });
  });

  test('leading REST duration matches first note offset from t=0', () => {
    const track = makeTrack([
      { midi: 36, time: 2.0, duration: 0.1 },
    ]);
    const [kickTrack] = expandPercussionTrack(track, gmDrumMap);
    expect(kickTrack.notes[0].name).toBe('REST');
    expect(kickTrack.notes[0].duration).toBeCloseTo(2.0, 5);
  });

  test('no leading REST when first note starts at t=0', () => {
    const track = makeTrack([
      { midi: 36, time: 0, duration: 0.1 },
    ]);
    const [kickTrack] = expandPercussionTrack(track, gmDrumMap);
    expect(kickTrack.notes[0].name).toBe('C4');
  });

  test('returns empty array for track with no notes', () => {
    const result = expandPercussionTrack(makeTrack([]), gmDrumMap);
    expect(result).toHaveLength(0);
  });

  test('unknown MIDI note defaults to ffivValue 13 (Kick)', () => {
    const track = makeTrack([
      { midi: 0, time: 0, duration: 0.1 }, // 0 is not in gmDrumMap
    ]);
    const [defaultTrack] = expandPercussionTrack(track, gmDrumMap);
    expect(defaultTrack.ffivValue).toBe(13);
  });

  test('virtual tracks carry isPercussion=true and correct ffivValue', () => {
    const track = makeTrack([
      { midi: 42, time: 0, duration: 0.1 }, // Hihat → ffivValue 17
    ]);
    const [hihatTrack] = expandPercussionTrack(track, gmDrumMap);
    expect(hihatTrack.isPercussion).toBe(true);
    expect(hihatTrack.ffivValue).toBe(17);
  });
});
