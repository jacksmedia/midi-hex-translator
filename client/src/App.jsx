// client/src/App.jsx
import { useState } from 'react';

const FFIV_INSTRUMENTS = [
  { value: '01', name: '01 — Strings bowed' },
  { value: '02', name: '02 — Strings plucked' },
  { value: '03', name: '03 — Grand Piano' },
  { value: '04', name: '04 — Harp' },
  { value: '05', name: '05 — Organ' },
  { value: '06', name: '06 — Trumpet' },
  { value: '07', name: '07 — Flute' },
  { value: '08', name: '08 — Xylophone' },
  { value: '09', name: '09 — Bass Guitar' },
  { value: '0A', name: '0A — Timpani' },
  { value: '0B', name: '0B — Elec Piano' },
  { value: '0C', name: '0C — Snare low' },
  { value: '0D', name: '0D — Kick Drum' },
  { value: '0E', name: '0E — Snare hard' },
  { value: '0F', name: '0F — Conga' },
  { value: '10', name: '10 — Cymbals' },
  { value: '11', name: '11 — Hihat' },
  { value: '12', name: '12 — Cowbell' },
  { value: '13', name: '13 — Shaker' },
  { value: '14', name: '14 — Whistle' },
  { value: '15', name: '15 — Conga fuller' },
  { value: '16', name: '16 — Chocobo' },
];

function App() {
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('output');
  // keyed by slot index → FFIV hex string override (e.g. { 0: '04', 2: '07' })
  const [instrumentOverrides, setInstrumentOverrides] = useState({});

  async function handleUpload(e) {
    const file = e.target.files[0];
    setFileName(file.name.replace(/\.mid$/i, ''));
    setInstrumentOverrides({});

    const formData = new FormData();
    formData.append('midi', file);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    setResult(await response.json());
  }

  function getInstrumentValue(track) {
    return instrumentOverrides[track.slot] ?? track.ffivInstrument;
  }

  function handleInstrumentChange(slot, value) {
    setInstrumentOverrides(prev => ({ ...prev, [slot]: value }));
  }

  // Build the 32-byte instrument index blob from current slot values + overrides.
  // Format: [val, 00, val, 00, ...] for each used slot, padded to 32 bytes with 00s.
  function buildInstrumentIndexBytes() {
    const bytes = new Uint8Array(32);
    result.instrumentIndex.forEach((hexVal, slot) => {
      bytes[slot * 2] = parseInt(instrumentOverrides[slot] ?? hexVal, 16);
    });
    return bytes;
  }

  function handleSequenceDownload() {
    const bytes = new Uint8Array(result.sequence.map(t => parseInt(t, 16)));
    triggerDownload(bytes, `${fileName}.bin`);
  }

  function handleIndexDownload() {
    triggerDownload(buildInstrumentIndexBytes(), `${fileName}_inst_index.bin`);
  }

  function triggerDownload(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4">
      <h1 className="text-xl mb-2 text-center">MIDI to Hex Bytecode</h1>
      <h5 className="text-sm mb-4 text-center">by xJ4cks, Claude Sonnet 4.6 & ChatGPT-4T</h5>
      <h2 className="text-lg mb-4 text-center">Upload a MIDI file to get hex bytecode for the FFIV SNES rom</h2>
      <input type="file" accept=".mid" onChange={handleUpload} />
      {result && (
        <>
          <button onClick={handleSequenceDownload} style={{ marginLeft: '1rem' }}>
            Save sequence as .bin
          </button>
          <button onClick={handleIndexDownload} style={{ marginLeft: '0.5rem' }}>
            Save instrument index as .bin
          </button>
        </>
      )}
      {result && (
        <div className="mt-4">
          <p style={{ marginBottom: '1rem' }}>
            <strong>Instrument slots ({result.slotCount}):</strong>{' '}
            {result.instrumentIndex.map((v, i) => {
              const override = instrumentOverrides[i];
              return override ? `[${override}]` : v;
            }).join(' ')}
          </p>
          {result.tracks.map((track, i) => (
            <div key={i} style={{ marginBottom: '1.5rem' }}>
              <p style={{ marginBottom: '0.25rem' }}>
                <strong>Track {track.trackIndex}</strong>{' '}
                | {track.gmName} (GM {track.gmNumber}){' '}
                | Slot {track.slot}
                {track.isPercussion ? ' [PERC]' : ''}{' '}
                | FFIV instrument:{' '}
                <select
                  value={getInstrumentValue(track)}
                  onChange={e => handleInstrumentChange(track.slot, e.target.value)}
                >
                  {FFIV_INSTRUMENTS.map(inst => (
                    <option key={inst.value} value={inst.value}>{inst.name}</option>
                  ))}
                </select>
              </p>
              <pre className="bg-gray-100 p-2 wrapped">
                {track.hex.join(' ')}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
