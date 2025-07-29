const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const { parseMidiToEvents } = require('./parser');
const { translateEventsToHex } = require('./translator');

const app = express();
app.use(cors());

const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('midi'), async (req, res) => {
  const events = await parseMidiToEvents(req.file.path);
  const path = require('path');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/snes.json'), 'utf-8'));

  // const schema = JSON.parse(fs.readFileSync('./translation-schemas/snes.json', 'utf-8'));
  const hexes = translateEventsToHex(events, schema);

  fs.unlinkSync(req.file.path);

  res.send(hexes.join(' '));
});

app.listen(3001, () => console.log('Server running on http://localhost:3001'));
