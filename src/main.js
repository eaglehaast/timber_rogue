import * as THREE from 'three';

const TRUNK_R = 0.3;
const TREE_H = 12;
const CUT_H = 0.8;        // высота запила над землёй
const REACH = 1.0;        // докуда достаёт шина пилы от лица до коры
const SAW_SPEED = 0.12;   // метров глубины в секунду
const FALL_AT = 0.7;      // доля диаметра: тоньше этого недопил дерево не держит
const TOLERANCE = THREE.MathUtils.degToRad(10);
const SAME_KERF = Math.cos(THREE.MathUtils.degToRad(20));
const EYE = 1.7;
const G = 9.8;

const canvas = document.getElementById('scene');
const hintEl = document.getElementById('hint');
const depthEl = document.getElementById('depth');
const depthFillEl = document.getElementById('depthFill');
const handsEl = document.getElementById('hands');
const resultEl = document.getElementById('result');
const startEl = document.getElementById('start');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e4);
scene.fog = new THREE.Fog(0x9cc4e4, 30, 90);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a30, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(20, 30, 10);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: 0x5d8a3a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const barkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f5d2a });
const kerfMat = new THREE.MeshBasicMaterial({ color: 0x1a0f08 });
const targetMat = new THREE.MeshBasicMaterial({
  color: 0x4cff6a, transparent: true, opacity: 0.35, depthWrite: false,
});

// Направление на земле задаём азимутом: 0 — вдоль +x, против часовой стрелки при взгляде сверху.
// Так же считают углы RingGeometry после поворота на землю, поэтому сектор цели совпадает с азимутом.
const dirOf = (az) => new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
const azimuthOf = (v) => Math.atan2(-v.z, v.x);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const player = { pos: new THREE.Vector3(0, 0, 4), yaw: 0, pitch: 0, bob: 0 };
const keys = new Set();
let sawing = false;
let round = null;

function newRound() {
  if (round) scene.remove(round.root);

  const stump = new THREE.Mesh(new THREE.CylinderGeometry(TRUNK_R, TRUNK_R * 1.1, CUT_H, 24), barkMat);
  stump.position.y = CUT_H / 2;

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(TRUNK_R * 0.6, TRUNK_R, TREE_H - CUT_H, 24), barkMat);
  trunk.position.y = CUT_H + (TREE_H - CUT_H) / 2;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 12), crownMat);
  crown.position.y = TREE_H - 2;
  const upper = new THREE.Group();
  upper.add(trunk, crown);

  const targetAz = Math.random() * Math.PI * 2;
  const target = new THREE.Mesh(
    new THREE.RingGeometry(1, TREE_H + 2, 32, 1, targetAz - TOLERANCE, TOLERANCE * 2),
    targetMat,
  );
  target.rotation.x = -Math.PI / 2;
  target.position.y = 0.02;

  const kerf = new THREE.Group();
  kerf.position.y = CUT_H;

  const root = new THREE.Group();
  root.add(stump, upper, target, kerf);
  scene.add(root);

  round = {
    root, upper, kerf, targetAz,
    cutDir: null, depth: 0,
    pivot: null, axis: null, fallDir: null, angle: 0, speed: 0,
    done: false,
  };
  resultEl.hidden = true;
}

// Пропил — плоская срезанная часть круга ствола: всё, что ближе к пильщику, чем хорда на глубине depth.
// Радиус чуть больше ствола, чтобы пропил проступал на коре тёмной полосой.
function updateKerf() {
  const { kerf, cutDir, depth } = round;
  const old = kerf.children[0];
  if (old) {
    old.geometry.dispose();
    kerf.remove(old);
  }
  const r = TRUNK_R * 1.03;
  const chord = -TRUNK_R + depth;
  const a = Math.acos(THREE.MathUtils.clamp(chord / r, -1, 1));
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r, a, Math.PI * 2 - a, false);
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false }), kerfMat);
  mesh.rotation.x = -Math.PI / 2;
  kerf.add(mesh);
  kerf.rotation.y = azimuthOf(cutDir);
}

// Дерево валится на сторону пропила и поворачивается вокруг кромки недопила, как дверь на петле.
function startFall() {
  const { cutDir, depth } = round;
  round.fallDir = cutDir.clone().negate();
  round.axis = new THREE.Vector3(0, 1, 0).cross(round.fallDir);
  const pivot = new THREE.Group();
  pivot.position.copy(cutDir).multiplyScalar(-TRUNK_R + depth).setY(CUT_H);
  round.root.add(pivot);
  pivot.attach(round.upper);
  round.pivot = pivot;
  round.angle = 0.03;
}

function land() {
  round.done = true;
  const base = round.pivot.position;
  const tip = base.clone().addScaledVector(round.fallDir, TREE_H - CUT_H);
  const squashed = distanceToSegmentXZ(player.pos, base, tip) < 1;
  const miss = Math.abs(THREE.MathUtils.radToDeg(angleDiff(azimuthOf(round.fallDir), round.targetAz)));
  const deg = Math.round(miss);

  if (squashed) showResult('ПРИШИБЛО', 'Не стой на линии падения');
  else if (miss <= THREE.MathUtils.radToDeg(TOLERANCE)) showResult('ЗБС!', `Отклонение ${deg}°`);
  else showResult('ФУУ', `Мимо на ${deg}°`);
}

function showResult(title, note) {
  resultEl.innerHTML = `${title}<small>${note}</small><small>R — новое дерево</small>`;
  resultEl.hidden = false;
}

function distanceToSegmentXZ(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

// Расстояние по взгляду до коры, если взгляд (по горизонтали) упирается в ствол.
function distanceToBark(forward) {
  const along = -(player.pos.x * forward.x + player.pos.z * forward.z);
  if (along <= 0) return null;
  const perp2 = player.pos.x ** 2 + player.pos.z ** 2 - along ** 2;
  if (perp2 > TRUNK_R ** 2) return null;
  return along - Math.sqrt(TRUNK_R ** 2 - perp2);
}

function update(dt) {
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  const move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(forward);
  if (keys.has('KeyS')) move.sub(forward);
  if (keys.has('KeyD')) move.add(right);
  if (keys.has('KeyA')) move.sub(right);
  const moving = move.lengthSq() > 0;
  if (moving) {
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6 : 3;
    player.pos.addScaledVector(move.normalize(), speed * dt);
  }
  // Сквозь пень не пройти.
  const minDist = TRUNK_R + 0.35;
  const dist = Math.hypot(player.pos.x, player.pos.z);
  if (dist < minDist) player.pos.multiplyScalar(minDist / dist);

  const bark = round.pivot ? null : distanceToBark(forward);
  const reachable = bark !== null && bark < REACH;
  const sameKerf = !round.cutDir || forward.dot(round.cutDir) > SAME_KERF;
  const cutting = sawing && reachable && sameKerf;

  if (cutting) {
    if (!round.cutDir) round.cutDir = forward.clone();
    round.depth = Math.min(round.depth + SAW_SPEED * dt, TRUNK_R * 2);
    updateKerf();
    if (round.depth >= FALL_AT * TRUNK_R * 2) startFall();
  }

  if (round.pivot && !round.done) {
    // Падение стержня вокруг конца: угловое ускорение растёт с наклоном, поэтому сначала медленно, потом резко.
    round.speed += (3 * G / (2 * (TREE_H - CUT_H))) * Math.sin(round.angle) * dt;
    round.angle = Math.min(round.angle + round.speed * dt, Math.PI / 2);
    round.pivot.quaternion.setFromAxisAngle(round.axis, round.angle);
    if (round.angle === Math.PI / 2) land();
  }

  if (round.pivot) hintEl.textContent = round.done ? '' : 'Падает! Беги вбок!';
  else if (!reachable) hintEl.textContent = round.cutDir ? '' : 'Подойди к стволу';
  else if (!sameKerf) hintEl.textContent = 'Пили в тот же пропил';
  else hintEl.textContent = cutting ? '' : 'Зажми ЛКМ — пилить';

  depthEl.style.visibility = round.cutDir && !round.pivot ? 'visible' : 'hidden';
  depthFillEl.style.width = `${(round.depth / (FALL_AT * TRUNK_R * 2)) * 100}%`;

  let hx = 0, hy = 0;
  if (cutting) {
    hx = (Math.random() - 0.5) * 6;
    hy = (Math.random() - 0.5) * 6;
  } else if (moving) {
    player.bob += dt * 10;
    hx = Math.sin(player.bob) * 6;
    hy = Math.abs(Math.cos(player.bob)) * 8;
  }
  handsEl.style.transform = `translate(calc(-50% + ${hx}px), ${hy}px)`;

  camera.position.set(player.pos.x, EYE, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

// Захват мыши может не дать браузер (например, без жеста пользователя); игра от этого не ломается.
function lockPointer() {
  canvas.requestPointerLock()?.catch(() => {});
}

addEventListener('resize', resize);
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') newRound();
});
addEventListener('keyup', (e) => keys.delete(e.code));
startEl.addEventListener('click', () => {
  startEl.hidden = true;
  lockPointer();
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) lockPointer();
  sawing = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) sawing = false;
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) sawing = false;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0022, -1.5, 1.5);
});

resize();
newRound();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  update(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
});
