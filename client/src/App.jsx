// client/src/App.jsx
import { useState } from 'react';

function App() {
  const [hexDump, setHexDump] = useState('');


  async function handleUpload(e) {
    const formData = new FormData();
    formData.append('midi', e.target.files[0]);

    const response = await fetch('http://localhost:3001/upload', {
      method: 'POST',
      body: formData,
    });

    const result = await response.text();
    setHexDump(result);
  }

  return (
    <div className="p-4">
      <h1 className="text-xl mb-2">🎹 MIDI to Hex Bytecode</h1>
      <h5 className="text-sm mb-4">by xJ4cks & ChatGPT-4T</h5>
      <h2 className="text-lg mb-4">Upload a MIDI file to get hex bytecode for the FFIV SNES rom</h2>
      <input type="file" accept=".mid" onChange={handleUpload} />
      <pre className="mt-4 bg-gray-100 p-2 wrapped">
        {hexDump}
      </pre>
    </div>
  );
}

export default App;
