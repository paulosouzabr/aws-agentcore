// Pinball Revival — a compact single-table pinball game.
//
// Scoring model (kept consistent between what is shown and what is saved):
//   - Each bumper hit adds a base of 100 points plus 10 points per unit of
//     the ball's speed at the moment of impact (faster rallies pay more).
//   - The score accumulates across all three balls in a round.
//   - When the third ball drains, the running total becomes the final score
//     that is offered to the high-score table — nothing is recomputed or
//     rescaled between the HUD and the save request.

(() => {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const scoreValueEl = document.getElementById('scoreValue');
  const ballsValueEl = document.getElementById('ballsValue');
  const hitsValueEl = document.getElementById('hitsValue');
  const scoreListEl = document.getElementById('scoreList');

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayMessage = document.getElementById('overlayMessage');
  const startBlock = document.getElementById('startBlock');
  const startButton = document.getElementById('startButton');
  const saveForm = document.getElementById('saveForm');
  const playerNameInput = document.getElementById('playerName');
  const saveButton = document.getElementById('saveButton');
  const saveStatus = document.getElementById('saveStatus');
  const restartButton = document.getElementById('restartButton');

  // ---- Static table geometry -------------------------------------------------

  const GRAVITY = 820; // px/s^2
  const BALL_RADIUS = 9;
  const CHUTE_X_MIN = 364;
  const CHUTE_X_MAX = 404;
  const DRAIN_Y = H + BALL_RADIUS + 4; // past this, the ball is lost

  // Outer boundary + funnel walls (segments), excluding the right launch lane
  // (handled separately) and the bottom drain gap.
  const walls = [
    // left wall
    { x1: 16, y1: 16, x2: 16, y2: 560 },
    // top wall
    { x1: 16, y1: 16, x2: 364, y2: 16 },
    // right wall above the launch-lane gap
    { x1: 364, y1: 16, x2: 364, y2: 120 },
    // lane divider (separates launch chute from the main field)
    { x1: 364, y1: 120, x2: 364, y2: 600 },
    // right outer wall of the chute
    { x1: 404, y1: 16, x2: 404, y2: 616 },
    // bottom of the chute (ball rests here before launch)
    { x1: 364, y1: 616, x2: 404, y2: 616 },
    // left funnel guiding the ball toward the left flipper
    { x1: 16, y1: 560, x2: 110, y2: 616 },
    // right-side funnel (below main field, left of the chute) toward right flipper
    { x1: 364, y1: 600, x2: 300, y2: 616 },
  ];

  const bumpers = [
    { x: 130, y: 190, r: 24, color: '#2de3ff', lastHit: -1 },
    { x: 290, y: 150, r: 24, color: '#ff2d78', lastHit: -1 },
    { x: 210, y: 300, r: 26, color: '#ffb52d', lastHit: -1 },
  ];

  const leftFlipper = {
    pivot: { x: 110, y: 616 },
    length: 68,
    restAngle: 2.0,
    activeAngle: -0.3,
    angle: 2.0,
    active: false,
  };
  const rightFlipper = {
    pivot: { x: 310, y: 616 },
    length: 68,
    restAngle: Math.PI - 2.0,
    activeAngle: Math.PI - -0.3,
    angle: Math.PI - 2.0,
    active: false,
  };
  const FLIPPER_ANGULAR_SPEED = 14; // rad/s

  // ---- Game state --------------------------------------------------------

  // States: idle (pre-game) -> ready (ball in chute) -> playing -> between-balls
  // (waiting to launch the next ball) -> ready -> ... -> game-over.
  // The primary action (Enter key / start button) is a single dispatcher below
  // so every state that can be advanced that way is reachable from one place.
  let ball = null;
  let state = 'idle';
  let score = 0;
  let ballsLeft = 3;
  let bumperHits = 0;
  let plungerCharge = 0;
  let plungerCharging = false;
  let lastTime = null;
  let savePending = false;
  let saveAbortController = null;

  function resetRoundState() {
    score = 0;
    ballsLeft = 3;
    bumperHits = 0;
    for (const bumper of bumpers) bumper.lastHit = -1;
    updateHud();
  }

  function spawnBallInChute() {
    ball = {
      x: (CHUTE_X_MIN + CHUTE_X_MAX) / 2,
      y: 600,
      vx: 0,
      vy: 0,
    };
  }

  function updateHud() {
    scoreValueEl.textContent = String(score);
    ballsValueEl.textContent = String(ballsLeft);
    hitsValueEl.textContent = String(bumperHits);
  }

  // ---- Overlay control ----------------------------------------------------

  function showOverlay({ title, message, showStart, showSave, showRestart }) {
    overlayTitle.textContent = title;
    overlayMessage.textContent = message;
    startBlock.hidden = !showStart;
    saveForm.hidden = !showSave;
    restartButton.hidden = !showRestart;
    saveStatus.textContent = '';
    saveButton.disabled = false;
    restartButton.disabled = false;
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  // ---- Round flow ----------------------------------------------------------

  // Cancels any save in flight and resets save-related UI/state. Called
  // whenever a new round starts so a stale response can never land mid-play
  // or overwrite the high-score list after the player has moved on.
  function cancelPendingSave() {
    if (saveAbortController) {
      saveAbortController.abort();
      saveAbortController = null;
    }
    savePending = false;
    saveButton.disabled = false;
    restartButton.disabled = false;
    saveStatus.textContent = '';
  }

  function startRound() {
    cancelPendingSave();
    resetRoundState();
    hideOverlay();
    state = 'ready';
    startButton.textContent = 'Launch First Ball';
    spawnBallInChute();
  }

  // The single entry point for the Enter key and the start/launch button.
  // Each reachable state maps to exactly one action, so there is no separate
  // onclick rebinding to fall out of sync with the state machine.
  function primaryAction() {
    if (state === 'idle') {
      startRound();
    } else if (state === 'between-balls') {
      hideOverlay();
      state = 'ready';
      spawnBallInChute();
    }
  }

  function onBallDrained() {
    ball = null;
    ballsLeft -= 1;
    updateHud();
    if (ballsLeft > 0) {
      state = 'between-balls';
      startButton.textContent = 'Launch Next Ball';
      showOverlay({
        title: 'Ball Drained',
        message: `${ballsLeft} ball${ballsLeft === 1 ? '' : 's'} left. Press Enter or the button to launch the next ball.`,
        showStart: true,
        showSave: false,
        showRestart: false,
      });
    } else {
      state = 'game-over';
      leftFlipper.active = false;
      rightFlipper.active = false;
      plungerCharging = false;
      showOverlay({
        title: 'Game Over',
        message: `Final score: ${score}. Enter your name to save it to the high-score table.`,
        showStart: false,
        showSave: true,
        showRestart: true,
      });
      playerNameInput.value = '';
      playerNameInput.focus();
    }
  }

  // ---- Physics helpers ------------------------------------------------------

  function reflectOffSegment(seg) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((ball.x - seg.x1) * dx + (ball.y - seg.y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = seg.x1 + t * dx;
    const closestY = seg.y1 + t * dy;
    const nx = ball.x - closestX;
    const ny = ball.y - closestY;
    const dist = Math.hypot(nx, ny) || 1;
    if (dist < BALL_RADIUS) {
      const ux = nx / dist;
      const uy = ny / dist;
      const penetration = BALL_RADIUS - dist;
      ball.x += ux * penetration;
      ball.y += uy * penetration;
      const vDotN = ball.vx * ux + ball.vy * uy;
      if (vDotN < 0) {
        ball.vx -= 2 * vDotN * ux;
        ball.vy -= 2 * vDotN * uy;
        ball.vx *= 0.9;
        ball.vy *= 0.9;
      }
    }
  }

  function flipperTip(flipper) {
    return {
      x: flipper.pivot.x + flipper.length * Math.cos(flipper.angle),
      y: flipper.pivot.y + flipper.length * Math.sin(flipper.angle),
    };
  }

  function updateFlipper(flipper, dt) {
    const target = flipper.active ? flipper.activeAngle : flipper.restAngle;
    const diff = target - flipper.angle;
    const maxStep = FLIPPER_ANGULAR_SPEED * dt;
    const prevAngle = flipper.angle;
    if (Math.abs(diff) <= maxStep) {
      flipper.angle = target;
    } else {
      flipper.angle += Math.sign(diff) * maxStep;
    }
    flipper.angularVelocity = (flipper.angle - prevAngle) / dt;
  }

  function collideFlipper(flipper) {
    const tip = flipperTip(flipper);
    const seg = { x1: flipper.pivot.x, y1: flipper.pivot.y, x2: tip.x, y2: tip.y };
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((ball.x - seg.x1) * dx + (ball.y - seg.y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = seg.x1 + t * dx;
    const closestY = seg.y1 + t * dy;
    const nx = ball.x - closestX;
    const ny = ball.y - closestY;
    const dist = Math.hypot(nx, ny) || 1;
    const collisionRadius = BALL_RADIUS + 9;
    if (dist < collisionRadius) {
      const ux = nx / dist;
      const uy = ny / dist;
      const penetration = collisionRadius - dist;
      ball.x += ux * penetration;
      ball.y += uy * penetration;
      const vDotN = ball.vx * ux + ball.vy * uy;
      if (vDotN < 0) {
        ball.vx -= 2 * vDotN * ux;
        ball.vy -= 2 * vDotN * uy;
      }
      // Kick from the flipper's own angular motion, strongest while swinging up.
      const tipSpeed = (flipper.angularVelocity || 0) * flipper.length;
      ball.vx += -Math.sin(flipper.angle) * tipSpeed * 0.35;
      ball.vy += Math.cos(flipper.angle) * tipSpeed * 0.35;
      ball.vx *= 0.98;
      ball.vy *= 0.98;
    }
  }

  function collideBumpers(now) {
    for (const bumper of bumpers) {
      const dx = ball.x - bumper.x;
      const dy = ball.y - bumper.y;
      const dist = Math.hypot(dx, dy) || 1;
      const minDist = bumper.r + BALL_RADIUS;
      if (dist < minDist) {
        const ux = dx / dist;
        const uy = dy / dist;
        ball.x = bumper.x + ux * minDist;
        ball.y = bumper.y + uy * minDist;
        const speed = Math.hypot(ball.vx, ball.vy);
        const bounceSpeed = Math.max(speed * 1.15, 260);
        ball.vx = ux * bounceSpeed;
        ball.vy = uy * bounceSpeed;

        const points = 100 + Math.floor(speed / 10) * 10;
        score += points;
        bumperHits += 1;
        bumper.lastHit = now;
        updateHud();
      }
    }
  }

  function clampSpeed() {
    const maxSpeed = 900;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      ball.vx *= scale;
      ball.vy *= scale;
    }
  }

  function stepPhysics(dt, now) {
    updateFlipper(leftFlipper, dt);
    updateFlipper(rightFlipper, dt);

    if (state !== 'playing') return;

    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Keep inside the launch lane until it has cleared the lane's top gap.
    if (ball.x > CHUTE_X_MIN - BALL_RADIUS && ball.y > 120) {
      if (ball.x < CHUTE_X_MIN + BALL_RADIUS) ball.x = CHUTE_X_MIN + BALL_RADIUS;
    }
    if (ball.x > CHUTE_X_MAX - BALL_RADIUS) {
      ball.x = CHUTE_X_MAX - BALL_RADIUS;
      ball.vx = Math.min(ball.vx, 0);
    }

    for (const seg of walls) reflectOffSegment(seg);
    collideFlipper(leftFlipper);
    collideFlipper(rightFlipper);
    collideBumpers(now);
    clampSpeed();

    if (ball.y > DRAIN_Y) {
      onBallDrained();
    }
  }

  // ---- Rendering --------------------------------------------------------

  function drawFlipper(flipper) {
    const tip = flipperTip(flipper);
    ctx.strokeStyle = '#2de3ff';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#2de3ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(flipper.pivot.x, flipper.pivot.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);

    // Table background
    ctx.fillStyle = '#060611';
    ctx.fillRect(0, 0, W, H);

    // Walls
    ctx.strokeStyle = '#4a4a7a';
    ctx.lineWidth = 4;
    for (const seg of walls) {
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    // Bumpers
    for (const bumper of bumpers) {
      const sinceHit = now - bumper.lastHit;
      const lit = sinceHit >= 0 && sinceHit < 180;
      ctx.beginPath();
      ctx.arc(bumper.x, bumper.y, bumper.r, 0, Math.PI * 2);
      ctx.fillStyle = lit ? '#ffffff' : bumper.color;
      ctx.shadowColor = bumper.color;
      ctx.shadowBlur = lit ? 30 : 14;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(bumper.x, bumper.y, bumper.r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#060611';
      ctx.fill();
    }

    drawFlipper(leftFlipper);
    drawFlipper(rightFlipper);

    // Plunger meter
    if (state === 'ready') {
      const meterHeight = 120 * Math.min(plungerCharge, 1);
      ctx.fillStyle = '#ffb52d';
      ctx.shadowColor = '#ffb52d';
      ctx.shadowBlur = 10;
      ctx.fillRect(CHUTE_X_MIN + 6, 600 - meterHeight, 10, meterHeight);
      ctx.shadowBlur = 0;
    }

    // Ball
    if (ball) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#eef0ff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ---- Main loop ----------------------------------------------------------

  function frame(timestamp) {
    if (lastTime === null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    dt = Math.min(dt, 1 / 30);

    if (plungerCharging && state === 'ready') {
      plungerCharge = Math.min(plungerCharge + dt * 1.2, 1);
    }

    // Sub-step physics to reduce tunneling through thin segments at speed.
    const subSteps = 2;
    for (let i = 0; i < subSteps; i++) stepPhysics(dt / subSteps, timestamp);

    draw(timestamp);
    requestAnimationFrame(frame);
  }

  // ---- Input ----------------------------------------------------------------

  function isTypingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(document.activeElement)) return;

    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'z') {
      leftFlipper.active = true;
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === '/') {
      rightFlipper.active = true;
      e.preventDefault();
    } else if (e.key === ' ') {
      if (state === 'ready' && !plungerCharging) {
        plungerCharging = true;
      }
      e.preventDefault();
    } else if (e.key === 'Enter') {
      primaryAction();
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (isTypingTarget(document.activeElement)) return;

    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'z') {
      leftFlipper.active = false;
    } else if (e.key === 'ArrowRight' || e.key === '/') {
      rightFlipper.active = false;
    } else if (e.key === ' ') {
      if (plungerCharging && state === 'ready') {
        launchBall();
      }
      plungerCharging = false;
    }
  });

  function launchBall() {
    const power = 520 + plungerCharge * 420;
    ball.vy = -power;
    ball.vx = 0;
    plungerCharge = 0;
    state = 'playing';
  }

  startButton.addEventListener('click', () => {
    primaryAction();
  });

  restartButton.addEventListener('click', () => {
    if (savePending) return;
    startRound();
  });

  saveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (savePending) return;
    const name = playerNameInput.value.trim();
    if (!name) {
      saveStatus.textContent = 'Enter a name first.';
      return;
    }
    savePending = true;
    saveButton.disabled = true;
    restartButton.disabled = true;
    saveStatus.textContent = 'Saving...';
    const controller = new AbortController();
    saveAbortController = controller;
    try {
      const res = await fetch('scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          score,
          ballsPlayed: 3,
          bumperHits,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `Save failed (${res.status})`);
      }
      const data = await res.json();
      if (saveAbortController !== controller) return; // superseded by a new round
      renderScores(data.scores);
      saveStatus.textContent = 'Saved!';
      saveForm.hidden = true;
    } catch (err) {
      if (controller.signal.aborted) return; // round restarted; drop silently
      saveStatus.textContent = `${err.message} — try again.`;
      saveButton.disabled = false;
    } finally {
      if (saveAbortController === controller) {
        savePending = false;
        restartButton.disabled = false;
        saveAbortController = null;
      }
    }
  });

  // ---- High score list ----------------------------------------------------

  function renderScores(scores) {
    scoreListEl.innerHTML = '';
    if (!scores || scores.length === 0) {
      const li = document.createElement('li');
      li.className = 'score-empty';
      li.textContent = 'No scores yet. Be the first!';
      scoreListEl.appendChild(li);
      return;
    }
    scores.forEach((entry, i) => {
      const li = document.createElement('li');
      const rank = document.createElement('span');
      rank.className = 'score-rank';
      rank.textContent = `#${i + 1}`;
      const name = document.createElement('span');
      name.className = 'score-name';
      name.textContent = entry.name;
      const points = document.createElement('span');
      points.className = 'score-points';
      points.textContent = entry.score;
      li.append(rank, name, points);
      scoreListEl.appendChild(li);
    });
  }

  async function loadScores() {
    try {
      const res = await fetch('scores');
      const data = await res.json();
      renderScores(data.scores);
    } catch (err) {
      scoreListEl.innerHTML = '<li class="score-empty">Could not load scores.</li>';
    }
  }

  // ---- Boot -----------------------------------------------------------------

  updateHud();
  loadScores();
  showOverlay({
    title: 'Pinball Revival',
    message: 'Hold Space in the chute to charge the plunger, release to launch. Flip with the arrow keys.',
    showStart: true,
    showSave: false,
    showRestart: false,
  });
  requestAnimationFrame(frame);
})();
