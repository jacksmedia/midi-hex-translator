// client/src/App.jsx
import { useState } from 'react';

function App() {
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('output');

  async function handleUpload(e) {
    const file = e.target.files[0];
    setFileName(file.name.replace(/\.mid$/i, ''));

    const formData = new FormData();
    formData.append('midi', file);

    const response = await fetch('http://localhost:3001/upload', {
      method: 'POST',
      body: formData,
    });

    setResult(await response.json());
  }

  function handleDownload() {
    const allHex = result.tracks.flatMap(t => t.hex).filter(t => t !== '??');
    const bytes = new Uint8Array(allHex.map(t => parseInt(t, 16)));
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.bin`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4">
      <h1 className="text-xl mb-2">MIDI to Hex Bytecode</h1>
      <h5 className="text-sm mb-4">by xJ4cks & ChatGPT-4T</h5>
      <h2 className="text-lg mb-4">Upload a MIDI file to get hex bytecode for the FFIV SNES rom</h2>
      <input type="file" accept=".mid" onChange={handleUpload} />
      {result && (
        <button onClick={handleDownload} style={{ marginLeft: '1rem' }}>
          Save as .bin
        </button>
      )}
      {result && (
        <div className="mt-4">
          <p style={{ marginBottom: '0.5rem' }}>
            <strong>Instrument Index ({result.slotCount} slots):</strong>{' '}
            {result.instrumentIndex.join(' ')}
          </p>
          {result.tracks.map(track => (
            <div key={track.trackIndex} style={{ marginBottom: '1.5rem' }}>
              <p>
                <strong>Track {track.trackIndex}</strong>{' '}
                | {track.gmName} (GM {track.gmNumber}){' '}
                → FFIV {track.ffivInstrument}{' '}
                | Slot {track.slot}
                {track.isPercussion ? ' [PERC]' : ''}
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
