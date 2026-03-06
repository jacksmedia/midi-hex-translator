const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { parseMidiToEvents } = require('./parser');
const { translateTracksToHex } = require('./translator');

const app = express();
app.use(cors());

const upload = multer({ dest: 'uploads/' });

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/snes.json'), 'utf-8'));
const gmToFfiv = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/gm-to-ffiv.json'), 'utf-8'));

app.post('/upload', upload.single('midi'), async (req, res) => {
  const tracks = await parseMidiToEvents(req.file.path);
  const result = translateTracksToHex(tracks, schema, gmToFfiv);

  fs.unlinkSync(req.file.path);

  res.json(result);
});

app.listen(3001, () => console.log('Server running on http://localhost:3001'));
