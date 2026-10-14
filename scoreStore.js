// Durable high-score storage for Pinball Revival.
// Scores are written to a JSON file on disk after every change so they
// survive a server restart. Writes are atomic (write-temp + rename) to
// avoid corrupting the file if the process is killed mid-write.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'scores.json');
const MAX_ENTRIES = 20;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ scores: [] }, null, 2));
  }
}

function readAll() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.scores)) return [];
    return parsed.scores;
  } catch (err) {
    // Corrupt or unreadable file: fail safe to an empty board rather than crash.
    return [];
  }
}

function writeAll(scores) {
  ensureStore();
  const tmpFile = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify({ scores }, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

function getTopScores(limit = MAX_ENTRIES) {
  const scores = readAll();
  return scores
    .slice()
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
    .slice(0, limit);
}

function addScore({ name, score, ballsPlayed, bumperHits }) {
  const scores = readAll();
  const entry = {
    name,
    score,
    ballsPlayed,
    bumperHits,
    createdAt: Date.now(),
  };
  scores.push(entry);
  // Keep the stored file bounded; the board only ever displays the top entries anyway.
  scores.sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  const trimmed = scores.slice(0, MAX_ENTRIES);
  writeAll(trimmed);
  return entry;
}

module.exports = { getTopScores, addScore, MAX_ENTRIES };
