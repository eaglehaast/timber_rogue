import * as THREE from 'three';
import { tiles, soften } from './surface.js';
import { planHouse, buildHouse } from './house.js';

// Стенд дома отдельно от игры: сруб на лужайке, солнце, камера крутится мышью вокруг дома.
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
sun.position.set(-8, 14, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// Лужайка — та же акварельная трава, что в игре (20 плиток по 2 м).
const [grass] = tiles(['assets/textures/grass-clover.jpg']);
grass.repeat.set(30, 30);
const lawn = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), soften(new THREE.MeshLambertMaterial({ map: grass }), {
  contrast: 0.85, saturation: 0.65, scales: [0.13, 0.5], low: [0.8, 0.84, 0.82], high: [0.98, 0.98, 0.95], cells: [5, 4],
}));
lawn.receiveShadow = true;
scene.add(lawn);

let house = null;
const label = document.getElementById('seed');
function rebuild(seed) {
  if (house) scene.remove(house);
  const plan = planHouse(seed);
  house = buildHouse(plan);
  scene.add(house);
  label.textContent = `дом ${seed} · ${plan.w} × ${plan.d} м · ${plan.courses} венцов`;
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

function frame() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch))
    .multiplyScalar(view.dist).add(view.target);
  camera.lookAt(view.target);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
window.stand = { view, rebuild, renderer };
