const assetRoot = new URL('../assets/hud/saw-bench/', import.meta.url);
const blades = {
  30: { width: 294, x: 156.837222, y: 87.623395, matrix: [.622767857, .383928571, -.058333333, .958333333] },
  70: { width: 505, x: 25.641623, y: 6.742953, matrix: [.622353507, .38367313, -.058333333, .958333333] },
};
const bladeHeight = 64, poseWidth = 900, poseHeight = 600, coastSeconds = .5;
const spinUpSeconds = .09;
const runMetresPerSecond = 15, toothRepeatPixels = 48;
const finger = { x: 617, y: 351, width: 81, height: 87 };

async function picture(name) {
  const image = new Image();
  image.src = new URL(name + '.webp', assetRoot);
  await image.decode();
  return image;
}

function drawTile(ctx, sheet, tile, width) {
  ctx.drawImage(sheet, (tile % 4) * width, Math.floor(tile / 4) * bladeHeight,
    width, bladeHeight, 0, 0, width, bladeHeight);
}

// В течение экспозиции мимо одной точки проходит несколько зубьев. Суммируем восемь
// положений уже нарисованной цепи: на носу размытие само следует за изгибом шины.
function runningEdge(sheet, width) {
  const edge = document.createElement('canvas');
  edge.width = width; edge.height = bladeHeight;
  const ctx = edge.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1 / 8;
  for (let tile = 8; tile < 16; tile++) drawTile(ctx, sheet, tile, width);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = .28;
  ctx.fillStyle = '#302c2a';
  ctx.fillRect(0, 0, width, bladeHeight);
  return edge;
}

export async function makeHeldSaw(container, onState = () => {}) {
  const [grip, rest, down, banks] = await Promise.all([
    picture('grip'), picture('finger-rest'), picture('finger-down'),
    Promise.all(Object.keys(blades).map(async cm => {
      const [plate, links] = await Promise.all([picture('plate-' + cm), picture('chain-' + cm)]);
      return [cm, { plate, links, running: runningEdge(links, blades[cm].width) }];
    })),
  ]);
  const artwork = Object.fromEntries(banks);
  const blade = document.createElement('div'), chain = document.createElement('canvas'), pose = document.createElement('canvas');
  blade.style.cssText = 'position:absolute; transform-origin:0 0; background-size:100% 100%';
  for (const canvas of [chain, pose]) canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%';
  pose.width = poseWidth; pose.height = poseHeight;
  blade.append(chain); container.replaceChildren(blade, pose);
  const brush = pose.getContext('2d'), ink = chain.getContext('2d');
  brush.drawImage(grip, 0, 0);
  let length, pressed = false, speed = 0, phase = 0, lastFrame = -1, clock = 0, previous = 0;

  function drawFinger() {
    brush.clearRect(finger.x, finger.y, finger.width, finger.height);
    brush.drawImage(pressed ? down : rest, finger.x, finger.y);
  }
  function drawChain() {
    const tile = Math.floor(phase * 8);
    const exposure = Math.round(Math.min(1, speed / .45) * 8);
    const frame = exposure * 8 + tile;
    if (frame === lastFrame) return;
    lastFrame = frame;
    const { links, running } = artwork[length];
    const width = chain.width, blend = exposure / 8;
    ink.clearRect(0, 0, width, bladeHeight);
    // Даже на оборотах в металле слегка меняется тон. Основную часть кромки
    // даёт непрерывный след, при торможении проступают отдельные зубья.
    ink.globalCompositeOperation = 'source-over';
    ink.globalAlpha = 1 - blend;
    if (blend < 1) drawTile(ink, links, tile, width);
    if (blend > 0) {
      ink.globalCompositeOperation = 'lighter';
      ink.globalAlpha = .88 * blend;
      ink.drawImage(running, 0, 0);
      ink.globalAlpha = .12 * blend;
      drawTile(ink, links, tile + 8, width);
    }
  }
  function report() {
    const state = pressed ? 'running' : speed > 0 ? 'coasting' : 'idle';
    if (container.dataset.state === state) return;
    container.dataset.state = state;
    onState(state);
  }
  function tick(now) {
    const dt = Math.max(0, (now - previous) / 1000);
    previous = now;
    const before = speed;
    const ramp = pressed ? spinUpSeconds : coastSeconds;
    speed = pressed ? Math.min(1, before + dt / ramp) : Math.max(0, before - dt / ramp);
    const rampTime = Math.abs(speed - before) * ramp;
    const travel = (before + speed) * .5 * rampTime + speed * Math.max(0, dt - rampTime);
    const pixelsPerMetre = chain.width / (length / 100);
    phase = (phase + travel * runMetresPerSecond * pixelsPerMetre / toothRepeatPixels) % 1;
    drawChain(); report();
    clock = pressed || speed > 0 ? requestAnimationFrame(tick) : 0;
  }
  function stop() {
    if (clock) cancelAnimationFrame(clock);
    clock = 0; speed = 0;
    if (pressed) { pressed = false; drawFinger(); }
    if (length) drawChain();
    report();
  }
  function setLength(cm) {
    if (length === cm) return;
    stop();
    length = cm;
    const { width, x, y, matrix } = blades[cm];
    Object.assign(blade.style, {
      left: 100 * x / poseWidth + '%', top: 100 * y / poseHeight + '%',
      width: 100 * width / poseWidth + '%', height: 100 * bladeHeight / poseHeight + '%',
      transform: 'matrix(' + [...matrix, 0, 0].join(',') + ')',
      backgroundImage: 'url("' + artwork[cm].plate.src + '")',
    });
    chain.width = width; chain.height = bladeHeight;
    phase = 0; lastFrame = -1; drawChain(); drawFinger();
    container.dataset.length = String(cm);
  }
  function setThrottle(value) {
    if (pressed === value) return;
    pressed = value;
    drawFinger(); drawChain(); report();
    previous = performance.now();
    if (!clock) clock = requestAnimationFrame(tick);
  }
  setLength(70);
  return { setLength, setThrottle, stop };
}
