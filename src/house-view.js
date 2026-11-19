import * as THREE from 'three';
import { planHouse, buildHouse } from './house.js';
import { generator } from './random.js';
import { makeFence, YARD, GATES, WICKET } from './fence.js';
import { planGas, buildGas } from './gas.js';
import { planPower, buildPower } from './power.js';
import { planRoad, buildRoad } from './road.js';
import { planLand, buildLand } from './land.js';
import { planRiver, buildRiver } from './river.js';
import { planPier, buildPier } from './pier.js';
import { planField, buildField } from './field.js';
import { shapeGround, height, normal } from './terrain.js';
import { makeWorld, makeMeadow, RINGS } from './world.js';
import { driftClouds } from './sky.js';
import { blow, stepWind } from './wind.js';
import { EYE } from './player.js';
import { PHONE, mode } from './device.js';
import { attachGame, MAPLES } from './main.js';

// Один двор для облёта и игры. Здесь собирается участок и рисуется кадр; main.js ведёт клёны, пилу и игрока.
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(mode === 'game' ? 1 : Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const FOV = 45, camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
// Ближнего кольца панорамы (луг со стогами в 45 м) на стенде нет: вокруг двора будет своя местность объёмом
// по плану Никиты (2026-11-08). Земля тянется до кольца гор.
const world = await makeWorld(renderer, scene, [RINGS.far]);
const GROUND = 2 * RINGS.far[1];

// Дом стоит фасадом к улице у забора, за палисадником в 1,5–2,5 м (Никита, 2026-11-08: фасад прямо в линию забора
// не нравится). Боком с крыльцом — к воротам, в ASIDE от их середины. Земля под домом выровнена (terrain.js).
const PALISADE = [1.5, 2.5], ASIDE = 5;
const MEADOW = 106, OUTSIDE = 0.7; // м: сторона квадрата с травой (до поля за лесополосой); сколько травы за забором
let house = null, yard = null, layout = null;
const animated = [];
const label = document.getElementById('seed');
function rebuild(seed) {
  if (game.active && mode === 'fly') toggleWalk();
  if (house) {
    scene.remove(house, yard);
    for (const part of [house, yard]) part.traverse((o) => o.geometry?.dispose());
  }
  const plan = planHouse(seed), rnd = generator(seed + 13);
  house = buildHouse(plan);
  const front = PALISADE[0] + rnd() * (PALISADE[1] - PALISADE[0]);
  const door = plan.openings.find((o) => o.kind === 'door').wall === 'right' ? 1 : -1;
  const at = { x: GATES.at - door * (plan.w / 2 + ASIDE), z: YARD.d / 2 - front - plan.d / 2 };
  // Площадка под дом — всё, что он занимает с крыльцом и свесами крыши.
  const box = new THREE.Box3().setFromObject(house), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const pad = { x: at.x + mid.x, z: at.z + mid.z, w: size.x, d: size.z };
  const fence = YARD.d / 2, road = planRoad({ seed, fence }), land = planLand(seed, road.verge), river = planRiver({ seed, back: -fence }), field = planField(seed, river);
  shapeGround(seed, [pad, ...MAPLES], YARD.w, YARD.d, { dug: (x, z) => road.dug(x, z) + land.dug(x, z) + river.dug(x, z), calm: river.calm, rows: [...road.rows, ...river.rows] });
  at.y = height(at.x, at.z);
  const pier = planPier(river, seed);
  house.position.set(at.x, at.y, at.z);
  // Трава: во дворе густая, за забором — луг пореже, в лесополосе — сплошная и сочная, к краю квадрата MEADOW
  // сходит на нет; под домом и мостками её нет, на улице — как скажет колея, на поле за рекой — пшеница.
  // Двор — между боковыми заборами, от улицы до реки.
  const inside = (x, z, c, w, d) => Math.abs(x - c.x) < w / 2 && Math.abs(z - c.z) < d / 2;
  const lawn = (x, z) => (Math.abs(x) < YARD.w / 2 && z < fence && z > river.shore(x) ? 1
    : THREE.MathUtils.lerp(OUTSIDE, 1, land.lush(x, z)) * (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(x), Math.abs(z)), MEADOW / 2 - 3, MEADOW / 2)));
  const grass = (x, z) => {
    if (inside(x, z, pad, pad.w, pad.d) || pier.deck(x, z) > -Infinity || MAPLES.some((tree) => Math.hypot(x - tree.x, z - tree.z) < 0.8)) return 0;
    return road.grass(x, z) * lawn(x, z) * river.grass(x, z) * (1 - field.cover(x, z));
  };
  const gas = planGas(plan, at, { fence, gate: GATES.at });
  const power = planPower(plan, at, gas, { fence, keep: [WICKET, GATES, road.keep] });
  yard = new THREE.Group().add(makeMeadow(grass, MEADOW, GROUND, { trodden: (x, z) => Math.max(road.trodden(x, z), river.trodden(x, z)), lush: land.lush }), makeFence({ open: river.shore }), buildGas(gas), buildPower(power), buildRoad(road), buildLand(land), buildRiver(river, MEADOW), buildPier(pier), buildField(field));
  layout = { at, gas, power, road, pier, pad, river };
  scene.add(house, yard);
  animated.length = 0;
  for (const group of [house, yard]) group.traverse(part => { if (part.tick) animated.push(part); });
  blow(rnd() * Math.PI * 2, 0.05 + rnd() * 0.2, rnd() * 9);
  game.regrow(generator(seed + 41));
  view.target.set(at.x, at.y + 2.5, at.z);
  if (game.active) game.enter(spawn, 0, PHONE, false);
  label.textContent = `дом ${seed} · ${plan.w} × ${plan.d} м · ${plan.courses} венцов · палисадник ${front.toFixed(1)} м`;
}

// Камера на сфере вокруг точки над серединой дома: yaw — вокруг, pitch — вверх, dist — расстояние.
const view = { yaw: 0.7, pitch: 0.24, dist: 21, target: new THREE.Vector3() };
// Земля или настил мостков. Пешком за боковой и передний заборы не выйти, в реку тоже.
const ground = (x, z) => Math.max(height(x, z), layout.pier.deck(x, z));
const groundNormal = (x, z, out) => layout.pier.deck(x, z) >= height(x, z) ? out.set(0, 1, 0) : normal(x, z, out);
function walkable(x, z) {
  const { pad, pier, river } = layout;
  if (Math.abs(x) > YARD.w / 2 - 0.4 || z > YARD.d / 2 - 0.4) return false;
  if (Math.abs(x - pad.x) < pad.w / 2 + 0.35 && Math.abs(z - pad.z) < pad.d / 2 + 0.35) return false;
  return pier.deck(x, z) > -Infinity || (z >= river.shore(x) && height(x, z) >= river.level(x));
}
const game = attachGame({ scene, camera, ground, groundNormal, walkable });
const spawn = { x: MAPLES[1].x, z: MAPLES[1].z + 4 };

// В облёте мышь и палец водят камеру. Пешком мышью управляет игра, палец поворачивает взгляд или пилу.
const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => {
  if (game.active && e.pointerType === 'mouse') return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  canvas.setPointerCapture(e.pointerId);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, (e) => pointers.delete(e.pointerId));
canvas.addEventListener('pointermove', (e) => {
  const was = pointers.get(e.pointerId);
  if (!was) return;
  const before = [...pointers.values()];
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  const dx = e.clientX - was[0], dy = e.clientY - was[1];
  if (pointers.size === 1) {
    if (game.active) game.look(dx * 0.006, dy * 0.004);
    else {
      view.yaw -= dx * 0.006;
      view.pitch = THREE.MathUtils.clamp(view.pitch + dy * 0.004, -0.05, 1.3);
    }
  } else if (pointers.size === 2) {
    if (game.active) {
      const metres = 6 / canvas.clientHeight;
      game.touchWalk(-dx / 2 * metres, dy / 2 * metres);
      return;
    }
    const span = ([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    view.dist = THREE.MathUtils.clamp(view.dist * span(before) / Math.max(1, span([...pointers.values()])), 2, 60);
    // Середина пальцев сдвинулась на половину сдвига этого пальца; метров на точку экрана — сколько их видно на расстоянии dist.
    const metres = view.dist / canvas.clientHeight;
    shift(-dx / 2 * metres, dy / 2 * metres);
  }
});
canvas.addEventListener('wheel', (e) => {
  if (!game.active) view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), 2, 60);
  e.preventDefault();
}, { passive: false });
// Стрелки (или WASD) двигают точку, вокруг которой ходит камера: вперёд — куда смотришь, вбок — вбок;
// с Shift — втрое быстрее. Q и E — точку ниже и выше.
const held = new Set();
const MOVE = { speed: 5, fast: 3, keys: { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] } };
const another = () => rebuild(1 + Math.floor(Math.random() * 1e6));
const flight = document.querySelector('#flight'), walkButton = document.querySelector('#walk');
document.querySelector('#regrow').addEventListener('click', () => { game.regrow(); document.querySelector('#help').open = false; });
if (mode === 'fly') {
  flight.hidden = false;
  document.querySelector('#another').addEventListener('click', another);
  walkButton.addEventListener('click', () => { toggleWalk(); walkButton.blur(); });
  addEventListener('keydown', e => {
    if (walkButton.disabled) return;
    if (e.code === 'KeyF' && !e.repeat) toggleWalk();
    else if (!game.active) {
      if (e.code === 'KeyR' && !e.repeat) another();
      held.add(e.code);
    }
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => held.delete(e.code));
  addEventListener('blur', () => held.clear());
}
// Из-за забора или с крыши начинаем у клёна. Возвращаясь в облёт, оставляем точку обзора у ног игрока.
function toggleWalk() {
  held.clear();
  pointers.clear();
  if (game.active) {
    const { pos, yaw } = game.leave();
    view.target.copy(pos).setY(pos.y + EYE);
    Object.assign(view, { yaw, pitch: 0.3, dist: 6 });
    camera.fov = FOV;
    camera.updateProjectionMatrix();
  } else {
    const point = [view.target, camera.position].find(({ x, z }) => game.canStand(x, z));
    game.enter(point ?? spawn, point ? view.yaw : 0, PHONE);
  }
  walkButton.textContent = game.active ? 'Облёт' : 'Пешком';
  flight.classList.toggle('walking', game.active);
  document.querySelector('#help').open = false;
  document.querySelector('#help').hidden = !game.active;
}
// Сдвинуть точку на side метров вбок и ahead вперёд.
function shift(side, ahead) {
  // Камера смотрит из (sin yaw, cos yaw) на точку: вперёд — обратно этому направлению.
  const dx = -Math.sin(view.yaw) * ahead + Math.cos(view.yaw) * side, dz = -Math.cos(view.yaw) * ahead - Math.sin(view.yaw) * side;
  view.target.x += dx, view.target.z += dz;
  // Ходим внутри карты: дальше видно, что горы — картинка на кольце.
  const out = Math.hypot(view.target.x, view.target.z) / BOUND;
  if (out > 1) view.target.x /= out, view.target.z /= out;
  view.target.y = Math.max(ground(view.target.x, view.target.z) + 0.2, view.target.y);
}
function pan(dt) {
  let side = 0, ahead = 0;
  for (const code of held) [side, ahead] = [side + (MOVE.keys[code]?.[0] ?? 0), ahead + (MOVE.keys[code]?.[1] ?? 0)];
  const fast = held.has('ShiftLeft') || held.has('ShiftRight');
  const travel = MOVE.speed * (fast ? MOVE.fast : 1) * dt, step = travel / (Math.hypot(side, ahead) || 1);
  view.target.y += (Number(held.has('KeyE')) - Number(held.has('KeyQ'))) * travel;
  shift(side * step, ahead * step);
}
// Камера тоже не дальше BOUND от середины двора: на луче от точки к камере — сколько до этой границы.
const BOUND = 100;
function reach(target, dir) {
  const a = dir.x ** 2 + dir.z ** 2, b = 2 * (target.x * dir.x + target.z * dir.z), c = target.x ** 2 + target.z ** 2 - BOUND ** 2;
  return a < 1e-9 ? Infinity : (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

const clock = new THREE.Clock();
function frame(now) {
  // Живые части дома и двора (дым из трубы, огонёк счётчика) двигаются во времени, траву клонит ветер, облака плывут.
  const dt = Math.min(clock.getDelta(), 0.05);
  stepWind(dt);
  driftClouds(dt);
  for (const part of animated) part.tick(dt);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const ratio = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(w * ratio) || canvas.height !== Math.floor(h * ratio)) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    world.rays.setSize(size.x, size.y);
  }
  game.tick(now, dt);
  if (!game.active) {
    pan(dt);
    const dir = new THREE.Vector3(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch));
    camera.position.copy(view.target).addScaledVector(dir, Math.min(view.dist, reach(view.target, dir)));
    camera.lookAt(view.target);
  }
  const light = world.light(camera);
  game.renderInset(renderer, now);
  renderer.setViewport(0, 0, w, h);
  renderer.render(scene, camera);
  world.rays.render(camera, light, dt);
}
rebuild(Number(new URLSearchParams(location.search).get('seed')) || 1);
export async function startYard() {
  if (mode === 'game') game.enter(spawn, 0, PHONE, false);
  document.querySelector('#help').hidden = !game.active;
  await renderer.compileAsync(scene, camera);
  frame(performance.now());
  walkButton.disabled = false;
  renderer.setAnimationLoop(frame);
  window.stand = { view, rebuild, renderer, scene, get layout() { return layout; } };
}
