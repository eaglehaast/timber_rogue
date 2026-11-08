import * as THREE from 'three';
import { planHouse, buildHouse } from './house.js';
import { generator } from './random.js';
import { makeFence, YARD, GATES, WICKET } from './fence.js';
import { planGas, buildGas } from './gas.js';
import { planPower, buildPower } from './power.js';
import { buildRoad, roadCover } from './road.js';
import { shapeGround, height } from './terrain.js';
import { makeWorld, makeMeadow, fenced, RINGS } from './world.js';
import { driftClouds } from './sky.js';
import { blow, stepWind } from './wind.js';

// Стенд дома — тот же мир, что в игре (world.js): небо, панорамы, земля с рельефом и трава, — а во дворе
// вместо делянки сруб у забора, грунтовая улица, газовая труба и провода с улицы.
// Мышь — обойти дом, колесо — ближе и дальше, стрелки — идти, R — новый дом (новое зерно).
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
// Ближнего кольца панорамы (луг со стогами в 45 м) на стенде нет: вокруг двора будет своя местность объёмом
// по плану Никиты (2026-11-08). Земля тянется до кольца гор.
const world = await makeWorld(renderer, scene, [RINGS.far]);
const GROUND = 2 * RINGS.far[1];

// Дом стоит фасадом к улице у забора, за палисадником в 1,5–2,5 м (Никита, 2026-11-08: фасад прямо в линию забора
// не нравится). Боком с крыльцом — к воротам, в ASIDE от их середины. Земля под домом выровнена (terrain.js),
// трава не растёт под ним и на дороге.
const PALISADE = [1.5, 2.5], ASIDE = 5;
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
  shapeGround(seed, [pad], YARD.w, YARD.d);
  at.y = height(at.x, at.z);
  house.position.set(at.x, at.y, at.z);
  const fence = YARD.d / 2, road = roadCover(fence);
  const open = (x, z) => (Math.abs(x - pad.x) < pad.w / 2 && Math.abs(z - pad.z) < pad.d / 2 ? 0 : 1 - road(x, z));
  const gas = planGas(plan, at, { fence, gate: GATES.at });
  const power = planPower(plan, at, gas, { fence, keep: [WICKET, GATES] });
  yard = new THREE.Group().add(makeMeadow((x, z) => fenced(x, z) * open(x, z), 76, GROUND), makeFence(), buildGas(gas), buildPower(power), buildRoad({ seed, fence }));
  layout = { at, gas, power };
  scene.add(house, yard);
  blow(rnd() * Math.PI * 2, 0.05 + rnd() * 0.2, rnd() * 9);
  view.target.set(at.x, at.y + 1.6, at.z);
  label.textContent = `дом ${seed} · ${plan.w} × ${plan.d} м · ${plan.courses} венцов · палисадник ${front.toFixed(1)} м`;
}

// Камера на сфере вокруг точки над серединой дома: yaw — вокруг, pitch — вверх, dist — расстояние.
const view = { yaw: 0.35, pitch: 0.12, dist: 12, target: new THREE.Vector3() };
rebuild(Number(new URLSearchParams(location.search).get('seed')) || 1);
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.yaw -= (e.clientX - drag[0]) * 0.006;
  view.pitch = THREE.MathUtils.clamp(view.pitch + (e.clientY - drag[1]) * 0.004, -0.05, 1.3);
  drag = [e.clientX, e.clientY];
});
canvas.addEventListener('wheel', (e) => { view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), 2, 60); e.preventDefault(); }, { passive: false });
// Стрелки (или WASD) двигают точку, вокруг которой ходит камера: вперёд — куда смотришь, вбок — вбок;
// с Shift — втрое быстрее. Q и E — точку ниже и выше.
const held = new Set();
const MOVE = { speed: 5, fast: 3, keys: { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] } };
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') rebuild(1 + Math.floor(Math.random() * 1e6));
  held.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());
function walk(dt) {
  let side = 0, ahead = 0;
  for (const code of held) [side, ahead] = [side + (MOVE.keys[code]?.[0] ?? 0), ahead + (MOVE.keys[code]?.[1] ?? 0)];
  const step = MOVE.speed * dt * (held.has('ShiftLeft') || held.has('ShiftRight') ? MOVE.fast : 1);
  // Камера смотрит из (sin yaw, cos yaw) на точку: вперёд — обратно этому направлению.
  view.target.x += (-Math.sin(view.yaw) * ahead + Math.cos(view.yaw) * side) * step;
  view.target.z += (-Math.cos(view.yaw) * ahead - Math.sin(view.yaw) * side) * step;
  // Ходим внутри карты: дальше видно, что горы — картинка на кольце.
  const out = Math.hypot(view.target.x, view.target.z) / BOUND;
  if (out > 1) view.target.x /= out, view.target.z /= out;
  view.target.y = Math.max(height(view.target.x, view.target.z) + 0.2, view.target.y + ((held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0)) * step);
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
  camera.position.copy(view.target).addScaledVector(dir, Math.min(view.dist, reach(view.target, dir)));
  camera.lookAt(view.target);
  const light = world.light(camera);
  renderer.render(scene, camera);
  world.rays.render(camera, light, dt);
  requestAnimationFrame(frame);
}
frame();
window.stand = { view, rebuild, renderer, get layout() { return layout; } };
