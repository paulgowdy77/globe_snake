const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const stage = document.querySelector("#stage");
const overlay = document.querySelector("#overlay");
const startBtn = document.querySelector("#start");
const scoreEl = document.querySelector("#score");
const statusEl = document.querySelector("#status");
const leftBtn = document.querySelector("#left");
const rightBtn = document.querySelector("#right");

const SETTINGS = {
  nodeAngle: Math.PI / 60,
  historySize: 10,
  startingDirection: Math.PI / 4,
  gridSize: 36,
  fixedDelta: 16,
  cameraZ: 2.4,
  maxSpeedBoost: 0.6,
  initialGlobeScale: 0.85,
  globeGrowthPerOrb: 0.015,
  globeScaleLerp: 0.04,
  maxGlobeScale: 1.15,
};

let width = 0;
let height = 0;
let centerX = 0;
let centerY = 0;
let focalLength = 0;

let globeScale = SETTINGS.initialGlobeScale;
let targetGlobeScale = SETTINGS.initialGlobeScale;

let snake = [];
let pellet = null;
let gridPoints = [];
let direction = SETTINGS.startingDirection;
let score = 0;

let running = false;
let paused = false;
let gameOver = false;

let lastTime = performance.now();
let accumulator = 0;

const input = {
  left: false,
  right: false,
};

function pointFromSpherical(theta, phi) {
  const sinPhi = Math.sin(phi);
  return {
    x: Math.cos(theta) * sinPhi,
    y: Math.sin(theta) * sinPhi,
    z: Math.cos(phi),
  };
}

function copyPoint(src, dest = {}) {
  dest.x = src.x;
  dest.y = src.y;
  dest.z = src.z;
  return dest;
}

function rotateZ(angle, point) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const x = point.x;
  const y = point.y;
  point.x = cosA * x - sinA * y;
  point.y = sinA * x + cosA * y;
}

function rotateY(angle, point) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const x = point.x;
  const z = point.z;
  point.x = cosA * x + sinA * z;
  point.z = -sinA * x + cosA * z;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const collisionDistance = 2 * Math.sin(SETTINGS.nodeAngle);

function setScore(nextScore) {
  score = nextScore;
  scoreEl.textContent = score.toString();
}

function setStatus(text) {
  statusEl.textContent = text;
}

function buildGrid() {
  gridPoints = [];
  const n = SETTINGS.gridSize;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      gridPoints.push(pointFromSpherical((i / n) * Math.PI * 2, (j / n) * Math.PI));
    }
  }
}

function addSnakeNode() {
  const node = { x: 0, y: 0, z: -1, posQueue: [] };
  for (let i = 0; i < SETTINGS.historySize; i += 1) node.posQueue.push(null);

  if (snake.length > 0) {
    const last = snake[snake.length - 1];
    const lastPos = last.posQueue[SETTINGS.historySize - 1];

    if (lastPos) {
      copyPoint(lastPos, node);
    } else {
      copyPoint(last, node);
      rotateZ(-SETTINGS.startingDirection, node);
      rotateY(-SETTINGS.nodeAngle * 2, node);
      rotateZ(SETTINGS.startingDirection, node);
    }
  }

  snake.push(node);
}

function spawnPellet() {
  let tries = 0;
  while (tries < 200) {
    tries += 1;
    const candidate = pointFromSpherical(Math.random() * Math.PI * 2, Math.random() * Math.PI);
    if (!snake.some((node) => distance(candidate, node) < collisionDistance * 1.4)) {
      pellet = candidate;
      return;
    }
  }
  pellet = pointFromSpherical(Math.random() * Math.PI * 2, Math.random() * Math.PI);
}

function computeSpeed() {
  const baseSpeed = (SETTINGS.nodeAngle * 2) / (SETTINGS.historySize + 1);
  const boost = Math.min(score * 0.03, SETTINGS.maxSpeedBoost);
  return baseSpeed * (1 + boost);
}

function applySnakeStep(snakeVelocity) {
  let carry = null;

  for (let i = 0; i < snake.length; i += 1) {
    const node = snake[i];
    const oldPosition = copyPoint(node);

    if (i === 0) {
      rotateZ(-direction, node);
      rotateY(snakeVelocity, node);
      rotateZ(direction, node);
    } else if (carry) {
      copyPoint(carry, node);
    } else {
      rotateZ(-SETTINGS.startingDirection, node);
      rotateY(snakeVelocity, node);
      rotateZ(SETTINGS.startingDirection, node);
    }

    node.posQueue.unshift(oldPosition);
    carry = node.posQueue.pop();
  }
}

function rotateWorld(heading, angle) {
  const allPoints = [];
  if (pellet) allPoints.push(pellet);
  allPoints.push(...gridPoints);
  for (const node of snake) {
    allPoints.push(node);
    for (const queued of node.posQueue) {
      if (queued) allPoints.push(queued);
    }
  }

  for (const point of allPoints) {
    rotateZ(-heading, point);
    rotateY(angle, point);
    rotateZ(heading, point);
  }
}

function checkCollisions() {
  for (let i = 2; i < snake.length; i += 1) {
    if (distance(snake[0], snake[i]) < collisionDistance) {
      return "self";
    }
  }

  if (distance(snake[0], pellet) < collisionDistance) {
    return "pellet";
  }

  return null;
}

function update(deltaMs) {
  if (!running || paused || gameOver) return;

  // Smooth globe scale interpolation
  globeScale += (targetGlobeScale - globeScale) * SETTINGS.globeScaleLerp;

  accumulator += deltaMs;
  if (accumulator > SETTINGS.fixedDelta * 5) {
    accumulator = SETTINGS.fixedDelta * 5;
  }

  while (accumulator >= SETTINGS.fixedDelta) {
    accumulator -= SETTINGS.fixedDelta;

    if (input.left) direction -= 0.08;
    if (input.right) direction += 0.08;

    const snakeVelocity = computeSpeed();
    applySnakeStep(snakeVelocity);
    rotateWorld(direction, -snakeVelocity);

    const hit = checkCollisions();
    if (hit === "self") {
      endGame();
      break;
    }
    if (hit === "pellet") {
      addSnakeNode();
      setScore(score + 1);
      targetGlobeScale = Math.min(targetGlobeScale + SETTINGS.globeGrowthPerOrb, SETTINGS.maxGlobeScale);
      spawnPellet();
    }
  }
}

function getScaledFocalLength() {
  return focalLength * globeScale;
}

function project(point) {
  const p = copyPoint(point);
  p.z += SETTINGS.cameraZ;
  const scaledFocal = getScaledFocalLength();
  const scale = scaledFocal / p.z;

  return {
    x: centerX + p.x * scale,
    y: centerY + p.y * scale,
    r: scale,
    depth: 1 - (p.z - (SETTINGS.cameraZ - 1)) / 2,
  };
}

function drawPoint(point, radius, color) {
  const proj = project(point);
  const depth = Math.max(0.05, Math.min(1, proj.depth));
  ctx.beginPath();
  ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${depth})`;
  ctx.arc(proj.x, proj.y, radius * proj.r, 0, Math.PI * 2);
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, width, height);

  const scaledFocal = getScaledFocalLength();
  const glow = ctx.createRadialGradient(centerX, centerY, scaledFocal * 0.1, centerX, centerY, scaledFocal * 0.75);
  glow.addColorStop(0, "rgba(255,255,255,0.6)");
  glow.addColorStop(1, "rgba(214,227,232,0.2)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, scaledFocal * 0.72, 0, Math.PI * 2);
  ctx.fill();

  for (const point of gridPoints) {
    drawPoint(point, 0.005, { r: 74, g: 110, b: 120 });
  }

  for (let i = snake.length - 1; i >= 0; i -= 1) {
    drawPoint(snake[i], SETTINGS.nodeAngle, { r: 42, g: 157, b: 143 });
  }

  if (pellet) {
    drawPoint(pellet, SETTINGS.nodeAngle * 1.15, { r: 255, g: 138, b: 76 });
  }

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.arc(centerX, centerY, scaledFocal * 0.63, 0, Math.PI * 2);
  ctx.stroke();
}

function loop(now) {
  const delta = now - lastTime;
  lastTime = now;
  update(delta);
  render();
  requestAnimationFrame(loop);
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = rect.width * dpr;
  height = rect.height * dpr;
  canvas.width = width;
  canvas.height = height;
  centerX = width / 2;
  centerY = height / 2;
  focalLength = Math.min(width, height) * 0.7;
}

function resetGame() {
  snake = [];
  direction = SETTINGS.startingDirection;
  setScore(0);
  globeScale = SETTINGS.initialGlobeScale;
  targetGlobeScale = SETTINGS.initialGlobeScale;
  buildGrid();
  for (let i = 0; i < 9; i += 1) addSnakeNode();
  spawnPellet();
  gameOver = false;
  setStatus("Live");
}

function showOverlay(title, body, buttonText) {
  overlay.classList.remove("hidden");
  overlay.querySelector("#overlay-title").textContent = title;
  overlay.querySelector("#overlay-body").textContent = body;
  startBtn.textContent = buttonText;
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function startGame() {
  if (!running || gameOver) {
    resetGame();
  }
  running = true;
  paused = false;
  gameOver = false;
  accumulator = 0;
  lastTime = performance.now();
  hideOverlay();
  setStatus("Live");
}

function pauseGame() {
  if (!running || gameOver) return;
  paused = true;
  setStatus("Paused");
  showOverlay("Paused", "Press space or tap start to resume.", "Resume");
}

function endGame() {
  running = false;
  gameOver = true;
  paused = false;
  setStatus("Game Over");
  showOverlay("Good run", "You hit your tail. Ready for another orbit?", "Play again");
}

function setInput(directionKey, isDown) {
  input[directionKey] = isDown;
  if (directionKey === "left") {
    leftBtn.classList.toggle("active", isDown);
  }
  if (directionKey === "right") {
    rightBtn.classList.toggle("active", isDown);
  }
}

function attachInput() {
  document.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "KeyA"].includes(event.code)) {
      event.preventDefault();
      setInput("left", true);
    }
    if (["ArrowRight", "KeyD"].includes(event.code)) {
      event.preventDefault();
      setInput("right", true);
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (paused) startGame();
      else pauseGame();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "KeyA"].includes(event.code)) {
      event.preventDefault();
      setInput("left", false);
    }
    if (["ArrowRight", "KeyD"].includes(event.code)) {
      event.preventDefault();
      setInput("right", false);
    }
  });

  const pointerPress = (directionKey) => (event) => {
    event.preventDefault();
    setInput(directionKey, true);
  };

  const pointerRelease = (directionKey) => (event) => {
    event.preventDefault();
    setInput(directionKey, false);
  };

  leftBtn.addEventListener("pointerdown", pointerPress("left"));
  leftBtn.addEventListener("pointerup", pointerRelease("left"));
  leftBtn.addEventListener("pointerleave", pointerRelease("left"));

  rightBtn.addEventListener("pointerdown", pointerPress("right"));
  rightBtn.addEventListener("pointerup", pointerRelease("right"));
  rightBtn.addEventListener("pointerleave", pointerRelease("right"));

  canvas.addEventListener("pointerdown", (event) => {
    const rect = canvas.getBoundingClientRect();
    const isLeft = event.clientX - rect.left < rect.width / 2;
    setInput(isLeft ? "left" : "right", true);
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointerup", (event) => {
    setInput("left", false);
    setInput("right", false);
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointerleave", () => {
    setInput("left", false);
    setInput("right", false);
  });
}

startBtn.addEventListener("click", () => {
  if (paused || gameOver) {
    startGame();
  } else if (!running) {
    startGame();
  }
});

window.addEventListener("resize", () => {
  resizeCanvas();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseGame();
  }
});

resizeCanvas();
attachInput();
setStatus("Ready");
showOverlay("Globe Snake", "Turn left/right to stay on the sphere. Eat the bright orb. Avoid your tail.", "Start");
requestAnimationFrame(loop);
