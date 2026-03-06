const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { parseMidiToEvents } = require('./parser');
const { translateTracksToHex, assembleSPCSequence } = require('./translator');

const app = express();
app.use(cors());

const upload = multer({ dest: 'uploads/' });

const schema    = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/snes.json'), 'utf-8'));
const gmToFfiv  = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/gm-to-ffiv.json'), 'utf-8'));
const gmDrumMap = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/gm-drums.json'), 'utf-8'));

app.post('/upload', upload.single('midi'), async (req, res) => {
  const tracks = await parseMidiToEvents(req.file.path);
  const result = translateTracksToHex(tracks, schema, gmToFfiv, gmDrumMap);
  const sequence = assembleSPCSequence(result.tracks);

  fs.unlinkSync(req.file.path);

  const rawTracks = tracks.map(({ trackIndex, channel, gmName, gmNumber, isPercussion, notes }) => ({
    trackIndex,
    channel,
    gmName,
    gmNumber,
    isPercussion,
    noteCount: notes.length
  }));

  res.json({ ...result, sequence, rawTracks });
});

app.listen(3001, () => console.log('Server running on http://localhost:3001'));
