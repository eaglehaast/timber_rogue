import * as THREE from 'three';
import { tiles, soften } from './surface.js';
import { planHouse, buildHouse } from './house.js';
import { generator } from './random.js';
import { makeFence, YARD, GATES, WICKET } from './fence.js';
import { planGas, buildGas } from './gas.js';
import { planPower, buildPower } from './power.js';
import { castShadows } from './sky.js';

// Стенд дома отдельно от игры: сруб во дворе у забора, газовая труба и провода с улицы, солнце; камера крутится мышью вокруг дома.
// R — новый дом (новое зерно), колесо — ближе и дальше.
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; // свет как в игре (main.js)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c4e0);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);

scene.add(new THREE.HemisphereLight(0xb4ccec, 0x8f8a66, 1.7));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
sun.position.set(-12, 21, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// Лужайка — та же акварельная трава, что в игре (20 плиток по 2 м).
const [grass] = tiles(['assets/textures/grass-clover.jpg']);
grass.repeat.set(80, 80);
const lawn = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), soften(new THREE.MeshLambertMaterial({ map: grass }), {
  contrast: 0.85, saturation: 0.65, scales: [0.13, 0.5], low: [0.8, 0.84, 0.82], high: [0.98, 0.98, 0.95], cells: [5, 4],
}));
lawn.receiveShadow = true;
scene.add(lawn);

// Дом стоит фасадом к улице у забора, за палисадником в 1,5–2,5 м (Никита, 2026-11-08: фасад прямо в линию забора
// не нравится). Боком с крыльцом — к воротам, в ASIDE от их середины.
// Мир стенда — от середины дома: двор с забором, газом и проводами сдвинут так, чтобы дом оказался в нуле.
const PALISADE = [1.5, 2.5], ASIDE = 5;
let house = null, yard = null, layout = null;
const label = document.getElementById('seed');
function rebuild(seed) {
  if (house) scene.remove(house, yard);
  const plan = planHouse(seed);
  house = buildHouse(plan);
  const front = PALISADE[0] + generator(seed + 13)() * (PALISADE[1] - PALISADE[0]);
  const door = plan.openings.find((o) => o.kind === 'door').wall === 'right' ? 1 : -1;
  const at = { x: GATES.at - door * (plan.w / 2 + ASIDE), z: YARD.d / 2 - front - plan.d / 2 };
  const gas = planGas(plan, at, { fence: YARD.d / 2, gate: GATES.at });
  const power = planPower(plan, at, gas, { fence: YARD.d / 2, keep: [WICKET, GATES] });
  yard = new THREE.Group().add(makeFence(), buildGas(gas), buildPower(power));
  yard.position.set(-at.x, 0, -at.z);
  layout = { at, gas, power };
  scene.add(house, yard);
  label.textContent = `дом ${seed} · ${plan.w} × ${plan.d} м · ${plan.courses} венцов · палисадник ${front.toFixed(1)} м`;
}
rebuild(Number(new URLSearchParams(location.search).get('seed')) || 1);

// Камера на сфере вокруг точки над серединой дома: yaw — вокруг, pitch — вверх, dist — расстояние.
const view = { yaw: 0.35, pitch: 0.12, dist: 12, target: new THREE.Vector3(0, 1.6, 0) };
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.yaw -= (e.clientX - drag[0]) * 0.006;
  view.pitch = THREE.MathUtils.clamp(view.pitch + (e.clientY - drag[1]) * 0.004, -0.05, 1.3);
  drag = [e.clientX, e.clientY];
});
canvas.addEventListener('wheel', (e) => { view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), 2, 40); e.preventDefault(); }, { passive: false });
addEventListener('keydown', (e) => { if (e.code === 'KeyR') rebuild(1 + Math.floor(Math.random() * 1e6)); });

const clock = new THREE.Clock();
function frame() {
  // Живые части дома (дым из трубы) двигаются во времени.
  const dt = Math.min(clock.getDelta(), 0.1);
  house.traverse((o) => o.tick?.(dt));
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch))
    .multiplyScalar(view.dist).add(view.target);
  camera.lookAt(view.target);
  castShadows(renderer); // свет облаков: облаков на стенде нет — солнце чистое
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
window.stand = { view, rebuild, renderer, get layout() { return layout; } };
