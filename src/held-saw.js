const assetRoot = new URL('../assets/hud/saw-bench/', import.meta.url);
const blades = {
  30: { width: 294, x: 156.837222, y: 87.623395, matrix: [.622767857, .383928571, -.058333333, .958333333] },
  70: { width: 505, x: 25.641623, y: 6.742953, matrix: [.622353507, .38367313, -.058333333, .958333333] },
};
const bladeHeight = 64, poseWidth = 900, poseHeight = 600, coastSeconds = .5;
const finger = { x: 617, y: 351, width: 81, height: 87 };

async function picture(name) {
  const image = new Image();
  image.src = new URL(name + '.webp', assetRoot);
  await image.decode();
  return image;
}

export async function makeHeldSaw(container, onState = () => {}) {
  const [grip, rest, down, banks] = await Promise.all([
    picture('grip'), picture('finger-rest'), picture('finger-down'),
    Promise.all(Object.keys(blades).map(async cm => {
      const [plate, links] = await Promise.all([picture('plate-' + cm), picture('chain-' + cm)]);
      return [cm, { plate, links }];
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
  let length, pressed = false, speed = 0, phase = 0, lastTile = -1, clock = 0, previous = 0;

  function drawFinger() {
    brush.clearRect(finger.x, finger.y, finger.width, finger.height);
    brush.drawImage(pressed ? down : rest, finger.x, finger.y);
  }
  function drawChain() {
    // По восемь фаз для резкой и размытой цепи. Перерисовываем только сменившийся кадр.
    const tile = (speed > .2 ? 8 : 0) + Math.floor(phase * 8);
    if (tile === lastTile) return;
    lastTile = tile;
    const width = chain.width;
    ink.clearRect(0, 0, width, bladeHeight);
    ink.drawImage(artwork[length].links, (tile % 4) * width, Math.floor(tile / 4) * bladeHeight,
      width, bladeHeight, 0, 0, width, bladeHeight);
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
    const movingTime = pressed ? dt : Math.min(dt, before * coastSeconds);
    if (!pressed) speed = Math.max(0, before - dt / coastSeconds);
    phase = (phase + 2.65 * movingTime * (before + speed) / 2) % 1;
    drawChain(); report();
    clock = speed > 0 ? requestAnimationFrame(tick) : 0;
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
    phase = 0; lastTile = -1; drawChain(); drawFinger();
    container.dataset.length = String(cm);
  }
  function setThrottle(value) {
    if (pressed === value) return;
    pressed = value;
    if (pressed) speed = 1;
    drawFinger(); drawChain(); report();
    previous = performance.now();
    if (!clock) clock = requestAnimationFrame(tick);
  }
  setLength(70);
  return { setLength, setThrottle, stop };
}
