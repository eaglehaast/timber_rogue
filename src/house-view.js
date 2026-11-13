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
import { planHills } from './hills.js';
import { shapeGround, height } from './terrain.js';
import { makeWorld, makeMeadow, RINGS, EYE } from './world.js';
import { driftClouds } from './sky.js';
import { blow, stepWind } from './wind.js';
import { PHONE } from './device.js';

// Стенд дома — тот же мир, что в игре (world.js): небо, панорамы, земля с рельефом и трава, — а во дворе
// вместо делянки сруб у забора, грунтовая улица, газовая труба и провода с улицы.
// Мышь — обойти дом, колесо — ближе и дальше, стрелки — идти, R — новый дом (новое зерно), F — пешком, как игрок.
// На телефоне: палец — обойти, два пальца — щипком ближе и дальше, сдвигом идти, кнопки — новый дом и пешком.
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
// На телефоне экран втрое чаще по точкам, чем видит глаз: хватает полутора, кадр рисуется вчетверо быстрее, чем при трёх.
renderer.setPixelRatio(Math.min(devicePixelRatio, PHONE ? 1.5 : 2));
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
const label = document.getElementById('seed');
function rebuild(seed) {
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
  const fence = YARD.d / 2, road = planRoad({ seed, fence }), land = planLand(seed, road.verge), river = planRiver({ seed, back: -fence }), hills = planHills(seed);
  shapeGround(seed, [pad], YARD.w, YARD.d, { dug: (x, z) => road.dug(x, z) + land.dug(x, z) + river.dug(x, z) + hills.dug(x, z), calm: river.calm, rows: [...road.rows, ...river.rows] });
  at.y = height(at.x, at.z);
  const pier = planPier(river, seed);
  house.position.set(at.x, at.y, at.z);
  // Трава: во дворе густая, за забором — луг пореже, в лесополосе — сплошная и сочная, к краю квадрата MEADOW
  // сходит на нет; под домом и мостками её нет, на улице — как скажет колея. Двор — между боковыми заборами, от улицы до реки.
  const inside = (x, z, c, w, d) => Math.abs(x - c.x) < w / 2 && Math.abs(z - c.z) < d / 2;
  const lawn = (x, z) => (Math.abs(x) < YARD.w / 2 && z < fence && z > river.into(x) ? 1
    : THREE.MathUtils.lerp(OUTSIDE, 1, land.lush(x, z)) * (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(x), Math.abs(z)), MEADOW / 2 - 3, MEADOW / 2)));
  const grass = (x, z) => (inside(x, z, pad, pad.w, pad.d) || pier.deck(x, z) > -Infinity ? 0 : road.grass(x, z) * lawn(x, z) * river.grass(x, z));
  const gas = planGas(plan, at, { fence, gate: GATES.at });
  const power = planPower(plan, at, gas, { fence, keep: [WICKET, GATES, road.keep] });
  yard = new THREE.Group().add(makeMeadow(grass, MEADOW, GROUND, { trodden: (x, z) => Math.max(road.trodden(x, z), river.trodden(x, z)), lush: land.lush }), makeFence({ open: river.into }), buildGas(gas), buildPower(power), buildRoad(road), buildLand(land), buildRiver(river, MEADOW), buildPier(pier));
  layout = { at, gas, power, road, pier, pad, river };
  scene.add(house, yard);
  blow(rnd() * Math.PI * 2, 0.05 + rnd() * 0.2, rnd() * 9);
  if (walker.on) view.target.set(...settle(view.target.x, view.target.z));
  else view.target.set(at.x, at.y + 1.6, at.z);
  label.textContent = `дом ${seed} · ${plan.w} × ${plan.d} м · ${plan.courses} венцов · палисадник ${front.toFixed(1)} м`;
}

// Камера на сфере вокруг точки над серединой дома: yaw — вокруг, pitch — вверх, dist — расстояние.
const view = { yaw: 0.35, pitch: 0.12, dist: 12, target: new THREE.Vector3() };
// Пешком — как игрок в игре (main.js): глаза на высоте EYE над землёй или настилом мостков, угол обзора тот же,
// шаг 3 м/с, с Shift — бегом вдвое быстрее, на каждом шаге голова чуть опускается (rise; бегом вдвое).
// Точка view.target — где стоишь, взгляд — от камеры облёта к точке. Мышь захвачена и водит взгляд (Esc отпускает).
// Законы те же, что в игре: тело — круг радиусом body, за забор не выйти (ворота и калитка закрыты, от досок
// держимся на fence), сквозь дом с крыльцом и свесами не пройти. Сзади двора забора нет, но в реку не зайти —
// по воде только настил мостков. Облёт — камера, она летает свободно.
const WALK = { speed: 3, fast: 2, fov: 55, stride: 0.75, rise: 0.012, mouse: 0.0022, body: 0.35, fence: 0.4 };
const walker = { on: false, bob: 0, gait: 0 };
// Можно ли стоять в точке.
function free(x, z) {
  const { pad, pier, river } = layout;
  if (Math.abs(x) > YARD.w / 2 - WALK.fence || z > YARD.d / 2 - WALK.fence) return false;
  if (Math.abs(x - pad.x) < pad.w / 2 + WALK.body && Math.abs(z - pad.z) < pad.d / 2 + WALK.body) return false;
  return pier.deck(x, z) > -Infinity || height(x, z) >= river.level(x);
}
// Где встать, если зашёл пешком из облёта (или под ногами вырос новый дом): во дворе ближе всего к точке x, z —
// внутри забора, не дальше задней границы двора (до воды) и у ближней стороны дома, если точка в нём. Возвращает [x, y, z].
function settle(x, z) {
  const { pad } = layout, half = [pad.w / 2 + WALK.body, pad.d / 2 + WALK.body];
  x = THREE.MathUtils.clamp(x, -YARD.w / 2 + WALK.fence, YARD.w / 2 - WALK.fence);
  z = THREE.MathUtils.clamp(z, -YARD.d / 2, YARD.d / 2 - WALK.fence);
  const [bx, bz] = [[x, z], [pad.x - half[0], z], [pad.x + half[0], z], [x, pad.z - half[1]], [x, pad.z + half[1]]]
    .filter(([a, b]) => free(a, b)).reduce((p, q) => (Math.hypot(q[0] - x, q[1] - z) < Math.hypot(p[0] - x, p[1] - z) ? q : p));
  return [bx, 0, bz];
}
rebuild(Number(new URLSearchParams(location.search).get('seed')) || 1);
// Пальцы и мышь — указатели: один ведёт камеру вокруг точки (пешком — взгляд), два — щипок (ближе и дальше)
// и сдвиг (точка идёт, как будто тянешь землю: пальцы вверх — вперёд).
const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  canvas.setPointerCapture(e.pointerId);
  if (walker.on && e.pointerType === 'mouse' && document.pointerLockElement !== canvas) canvas.requestPointerLock()?.catch(() => {});
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) turn(e.movementX * WALK.mouse, e.movementY * WALK.mouse);
});
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (e) => pointers.delete(e.pointerId));
canvas.addEventListener('pointermove', (e) => {
  const was = pointers.get(e.pointerId);
  if (!was) return;
  const before = [...pointers.values()];
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  const dx = e.clientX - was[0], dy = e.clientY - was[1];
  if (pointers.size === 1) {
    turn(dx * 0.006, dy * 0.004);
  } else if (pointers.size === 2) {
    const span = ([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    view.dist = THREE.MathUtils.clamp(view.dist * span(before) / span([...pointers.values()]), 2, 60);
    // Середина пальцев сдвинулась на половину сдвига этого пальца; метров на точку экрана — сколько их видно на расстоянии dist.
    const metres = view.dist / canvas.clientHeight;
    shift(-dx / 2 * metres, dy / 2 * metres);
  }
});
canvas.addEventListener('wheel', (e) => { view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), 2, 60); e.preventDefault(); }, { passive: false });
// Стрелки (или WASD) двигают точку, вокруг которой ходит камера: вперёд — куда смотришь, вбок — вбок;
// с Shift — втрое быстрее. Q и E — точку ниже и выше.
const held = new Set();
const MOVE = { speed: 5, fast: 3, keys: { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] } };
const another = () => rebuild(1 + Math.floor(Math.random() * 1e6));
const keys = document.getElementById('keys'), walkButton = document.getElementById('walk');
// Подсказка облёта и пешком.
const HELP = PHONE ? ['Палец — обойти · два пальца: щипок — ближе, сдвиг — идти', 'Палец — оглядеться · два пальца сдвигом — идти']
  : [keys.textContent, 'Щелчок — мышь водит взгляд (Esc — отпустить) · WASD — шаги (Shift — бегом) · F — облёт · R — новый дом'];
keys.textContent = HELP[0];
if (PHONE) {
  const button = document.getElementById('another');
  button.hidden = false;
  button.addEventListener('click', another);
}
walkButton.addEventListener('click', () => { toggleWalk(); walkButton.blur(); });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') another();
  if (e.code === 'KeyF' && !e.repeat) toggleWalk();
  held.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());
// Пешком встаём туда, где висела камера облёта, и смотрим туда же; обратно — камера отлетает за спину.
function toggleWalk() {
  walker.on = !walker.on;
  if (walker.on) view.target.set(...settle(camera.position.x, camera.position.z)), view.pitch = 0;
  else {
    document.exitPointerLock?.();
    view.target.y = ground(view.target.x, view.target.z) + EYE;
    Object.assign(view, { pitch: 0.3, dist: 6 });
  }
  camera.fov = walker.on ? WALK.fov : FOV;
  camera.updateProjectionMatrix();
  walkButton.textContent = walker.on ? 'Облёт' : 'Пешком';
  keys.textContent = HELP[walker.on ? 1 : 0];
}
// Повернуть взгляд: облёт — камеру вокруг точки, пешком — голову (вниз и вверх почти до отвеса).
function turn(dx, dy) {
  view.yaw -= dx;
  view.pitch = THREE.MathUtils.clamp(view.pitch + dy, walker.on ? -1.4 : -0.05, walker.on ? 1.4 : 1.3);
}
// Под ногами земля или настил мостков: на них можно зайти.
const ground = (x, z) => Math.max(height(x, z), layout.pier.deck(x, z));
// Сдвинуть точку на side метров вбок и ahead вперёд.
function shift(side, ahead) {
  // Камера смотрит из (sin yaw, cos yaw) на точку: вперёд — обратно этому направлению.
  const dx = -Math.sin(view.yaw) * ahead + Math.cos(view.yaw) * side, dz = -Math.cos(view.yaw) * ahead - Math.sin(view.yaw) * side;
  if (walker.on) {
    // Упёрся — скользишь вдоль препятствия: шаг идёт по той оси, по которой можно.
    const { x, z } = view.target, [mx, mz] = [[dx, dz], [dx, 0], [0, dz]].find(([a, b]) => free(x + a, z + b)) ?? [0, 0];
    view.target.x += mx, view.target.z += mz;
    return;
  }
  view.target.x += dx, view.target.z += dz;
  // Ходим внутри карты: дальше видно, что горы — картинка на кольце.
  const out = Math.hypot(view.target.x, view.target.z) / BOUND;
  if (out > 1) view.target.x /= out, view.target.z /= out;
  view.target.y = Math.max(ground(view.target.x, view.target.z) + 0.2, view.target.y);
}
function walk(dt) {
  let side = 0, ahead = 0;
  for (const code of held) [side, ahead] = [side + (MOVE.keys[code]?.[0] ?? 0), ahead + (MOVE.keys[code]?.[1] ?? 0)];
  const fast = held.has('ShiftLeft') || held.has('ShiftRight'), { speed, fast: faster } = walker.on ? WALK : MOVE;
  const pace = side || ahead ? speed * (fast ? faster : 1) : 0, step = (pace * dt) / (Math.hypot(side, ahead) || 1);
  if (!walker.on) view.target.y += ((held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0)) * speed * dt * (fast ? faster : 1);
  shift(side * step, ahead * step);
  // Шаги как в игре: фаза идёт по пройденному пути (шаг — полоборота), размах растёт со скоростью.
  walker.gait += (pace / WALK.speed - walker.gait) * (1 - Math.exp(-6 * dt));
  walker.bob += (pace * dt * Math.PI) / WALK.stride;
}
// Камера тоже не дальше BOUND от середины двора: на луче от точки к камере — сколько до этой границы.
const BOUND = 100;
function reach(target, dir) {
  const a = dir.x ** 2 + dir.z ** 2, b = 2 * (target.x * dir.x + target.z * dir.z), c = target.x ** 2 + target.z ** 2 - BOUND ** 2;
  return a < 1e-9 ? Infinity : (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

const clock = new THREE.Clock();
function frame() {
  // Живые части дома и двора (дым из трубы, огонёк счётчика) двигаются во времени, траву клонит ветер, облака плывут.
  const dt = Math.min(clock.getDelta(), 0.1);
  stepWind(dt);
  driftClouds(dt);
  for (const part of [house, yard]) part.traverse((o) => o.tick?.(dt));
  walk(dt);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    world.rays.setSize(size.x, size.y);
  }
  const dir = new THREE.Vector3(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch));
  if (walker.on) {
    const { x, z } = view.target;
    camera.position.set(x, ground(x, z) + EYE - WALK.rise * walker.gait * Math.sin(walker.bob) ** 2, z);
    camera.lookAt(camera.position.clone().sub(dir));
  } else {
    camera.position.copy(view.target).addScaledVector(dir, Math.min(view.dist, reach(view.target, dir)));
    camera.lookAt(view.target);
  }
  const light = world.light(camera);
  renderer.render(scene, camera);
  world.rays.render(camera, light, dt);
  requestAnimationFrame(frame);
}
frame();
window.stand = { view, rebuild, renderer, scene, get layout() { return layout; } };
