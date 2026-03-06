const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseMidiToEvents } = require('../server/parser');
const { translateTracksToHex, assembleSPCSequence } = require('../server/translator');

const schema    = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/snes.json'), 'utf-8'));
const gmToFfiv  = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/gm-to-ffiv.json'), 'utf-8'));
const gmDrumMap = JSON.parse(fs.readFileSync(path.join(__dirname, '../translation-schemas/gm-drums.json'), 'utf-8'));

const upload = multer({ storage: multer.memoryStorage() });

// Disable Vercel's built-in body parser so multer can handle multipart data.
module.exports.config = {
  api: { bodyParser: false },
};

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, result => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await runMiddleware(req, res, upload.single('midi'));

  const tracks = await parseMidiToEvents(req.file.buffer);
  const result = translateTracksToHex(tracks, schema, gmToFfiv, gmDrumMap);
  const sequence = assembleSPCSequence(result.tracks);

  res.json({ ...result, sequence });
};
