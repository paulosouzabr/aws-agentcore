const path = require('path');
const express = require('express');
const cors = require('cors');
const scoreStore = require('./scoreStore');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

const NAME_MAX_LEN = 24;
const MIN_SCORE = 0;
const MAX_SCORE = 999999; // generous ceiling; well above any mechanically achievable score

function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= NAME_MAX_LEN;
}

function isValidScore(score) {
  return typeof score === 'number' && Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE;
}

function isValidCount(value) {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

app.get('/scores', (req, res) => {
  res.json({ scores: scoreStore.getTopScores() });
});

app.post('/scores', (req, res) => {
  const body = req.body || {};
  const { name, score, ballsPlayed, bumperHits } = body;

  if (!isValidName(name)) {
    return res.status(400).json({ error: 'invalid_name', message: `name must be a string between 1 and ${NAME_MAX_LEN} characters` });
  }
  if (!isValidScore(score)) {
    return res.status(400).json({ error: 'invalid_score', message: `score must be an integer between ${MIN_SCORE} and ${MAX_SCORE}` });
  }
  if (!isValidCount(ballsPlayed)) {
    return res.status(400).json({ error: 'invalid_balls_played', message: 'ballsPlayed must be a non-negative integer when provided' });
  }
  if (!isValidCount(bumperHits)) {
    return res.status(400).json({ error: 'invalid_bumper_hits', message: 'bumperHits must be a non-negative integer when provided' });
  }

  const entry = scoreStore.addScore({
    name: name.trim(),
    score,
    ballsPlayed: ballsPlayed ?? null,
    bumperHits: bumperHits ?? null,
  });

  res.status(201).json({ entry, scores: scoreStore.getTopScores() });
});

app.listen(PORT, () => {
  console.log(`Pinball Revival listening on port ${PORT}`);
});
