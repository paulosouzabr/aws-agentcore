# Pinball Revival

A compact, single-table browser pinball game with a persistent high-score
table. One Express service serves both the game page and its score API.

## Concept and visual identity

Pinball Revival is a nostalgic nod to the classic Windows pinball games: a
tall neon-on-black table with glowing bumpers, chrome-blue flippers, and a
right-side launch lane with a chargeable plunger. The whole table is drawn
on an HTML5 `<canvas>` — no images, fonts, or scripts are loaded from
anywhere but this service.

## Core mechanic and controls

- **Launch**: hold `Space` while the ball sits in the chute to charge the
  plunger, then release to fire it into the field. Charging longer launches
  harder.
- **Flip**: `←` / `Z` for the left flipper, `→` / `/` for the right flipper.
- **Keep the rally alive**: steer the ball into the three glowing bumpers
  with your flippers before it drains past them.
- You get **3 balls** per round. The round ends when all three have drained.

## How score is earned

Every bumper struck adds `100 + 10 * floor(impact speed / 10)` points to a
running total — hitting a bumper while the ball is moving fast pays more
than a slow graze. The total accumulates across all three balls. When the
third ball drains, that running total is the final score shown on the
game-over screen; it is sent to the server exactly as displayed (no
separate recomputation), so what's shown always matches what's saved.

## Scores and persistence

High scores are stored durably on the server in `data/scores.json`, written
atomically (temp file + rename) on every save, so the table survives a
service restart. The top 20 entries are kept and served back on every page
load.

### API

- `GET /scores` → `{ "scores": [{ name, score, ballsPlayed, bumperHits, createdAt }, ...] }`
  (sorted descending by score, newest first on ties)
- `POST /scores` with JSON body `{ "name": string, "score": integer, "ballsPlayed"?: integer, "bumperHits"?: integer }`
  - `name`: 1–24 characters
  - `score`: integer, 0–999999
  - Invalid or missing fields get a `400` with a typed `error` code and a
    human-readable `message`. A successful save returns `201` with the new
    entry and the refreshed top-20 list.

The page talks to the API with relative URLs (`fetch('scores')`), so it
works unmodified from a plain checkout, behind a reverse-proxy path prefix,
or embedded in a sandboxed iframe. CORS (including JSON preflight) is
enabled for all origins so the sandboxed/published copy of the page can call
it with no cookies or auth headers.

## Run it

```
npm install
PORT=3000 npm start
```

(or just `npm start` to use the default port 3000). Then open
`http://localhost:3000/` in a browser. The server binds to the port in
`PORT` if set, otherwise 3000, and stays in the foreground serving both the
static game files in `public/` and the `/scores` API.

No build step, no database server, and no other setup is required —
`data/scores.json` is created automatically on first run.

## Scope notes (reserved for a later Lab 3 change)

This baseline is one table, one mechanic (flippers + bumpers), no sound, and
no alternate modes, by design, per the request's scope. Additional stages,
modes, and audio are intentionally left for an optional later change.
