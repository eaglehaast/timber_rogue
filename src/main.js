import * as THREE from 'three';
import { TrunkVoxels, VOXEL } from './trunk.js';

const TRUNK_R = 0.3;
const TREE_H = 12;
const ZONE_H = 1.5;       // низ ствола из вокселей: здесь можно пилить
const REACH = 1.0;        // докуда достаёт пила от лица до коры
const SAW_SPEED = 0.12;   // метров глубины в секунду
const BAR_L = 0.45;       // длина шины: ствол толще, с одной стороны насквозь не пропилить
const HOLD = 0.2;         // доля слоя: если недопил меньше, дерево не держится
const MAX_TILT = THREE.MathUtils.degToRad(60);
const MAX_TURN = THREE.MathUtils.degToRad(30);
const SNAP_DIST = 0.03;   // прицел прилипает к начатому пропилу, если почти совпал с ним
const SNAP_COS = Math.cos(THREE.MathUtils.degToRad(10));
const TOLERANCE = THREE.MathUtils.degToRad(10);
const EYE = 1.7;
const G = 9.8;
const MOUSE = 0.0022;

const canvas = document.getElementById('scene');
const hintEl = document.getElementById('hint');
const depthEl = document.getElementById('depth');
const depthFillEl = document.getElementById('depthFill');
const handsEl = document.getElementById('hands');
const resultEl = document.getElementById('result');
const startEl = document.getElementById('start');
const sectionEl = document.getElementById('section');
const sectionCtx = sectionEl.getContext('2d');

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
const voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f5d2a });
const targetMat = new THREE.MeshBasicMaterial({
  color: 0x4cff6a, transparent: true, opacity: 0.35, depthWrite: false,
});

// Прицел пилы: полупрозрачная плоскость, по которой пойдёт пропил, и сама шина на текущей глубине.
const aimPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(BAR_L, 2 * TRUNK_R),
  new THREE.MeshBasicMaterial({
    color: 0xff9a2e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  }),
);
const bar = new THREE.Mesh(
  new THREE.BoxGeometry(BAR_L, 0.05, 0.012),
  new THREE.MeshLambertMaterial({ color: 0x9a9aa0 }),
);
scene.add(aimPlane, bar);

// Направление на земле задаём азимутом: 0 — вдоль +x, против часовой стрелки при взгляде сверху.
// Так же считают углы RingGeometry после поворота на землю, поэтому сектор цели совпадает с азимутом.
const dirOf = (az) => new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
const azimuthOf = (v) => Math.atan2(-v.z, v.x);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const forwardOf = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));

const player = { pos: new THREE.Vector3(0, 0, 4), yaw: 0, pitch: 0, bob: 0 };
const keys = new Set();
// free — ходим и смотрим; aim — пила приставлена, мышь крутит полотно; cut — пилим.
let mode = 'free';
let saw = null;
let round = null;

// Ствол выше зоны пиления — обычный цилиндр, сужается к вершине.
function upperTrunk() {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(TRUNK_R * 0.6, TRUNK_R, TREE_H - ZONE_H, 48), barkMat);
  mesh.position.y = (ZONE_H + TREE_H) / 2;
  return mesh;
}

function newRound() {
  if (round) scene.remove(round.root);

  const voxels = new TrunkVoxels(TRUNK_R, ZONE_H, voxelMat);
  voxels.remesh();
  const crown = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 12), crownMat);
  crown.position.y = TREE_H - 2;
  const upper = new THREE.Group();
  upper.add(upperTrunk(), crown);

  const targetAz = Math.random() * Math.PI * 2;
  const target = new THREE.Mesh(
    new THREE.RingGeometry(1, TREE_H + 2, 32, 1, targetAz - TOLERANCE, TOLERANCE * 2),
    targetMat,
  );
  target.rotation.x = -Math.PI / 2;
  target.position.y = 0.02;

  const root = new THREE.Group();
  root.add(voxels.group, upper, target);
  scene.add(root);

  round = {
    root, voxels, upper, targetAz,
    cuts: [],
    pivot: null, axis: null, fallDir: null, fallLen: 0, angle: 0, speed: 0,
    done: false,
  };
  mode = 'free';
  saw = null;
  resultEl.hidden = true;
}

// Пропил задан точкой входа на коре, поворотом по горизонтали и наклоном полотна.
// along — куда пила идёт вглубь, side — вдоль шины, normal — перпендикуляр к полотну.
function basis(cut) {
  const flat = forwardOf(cut.yaw);
  const side = new THREE.Vector3(-flat.z, 0, flat.x);
  const along = flat.multiplyScalar(Math.cos(cut.tilt)).setY(-Math.sin(cut.tilt));
  const normal = side.clone().cross(along);
  return { origin: cut.origin, along, side, normal };
}

// Расстояние по взгляду до коры, если взгляд (по горизонтали) упирается в ствол.
function distanceToBark(forward) {
  const along = -(player.pos.x * forward.x + player.pos.z * forward.z);
  if (along <= 0) return null;
  const perp2 = player.pos.x ** 2 + player.pos.z ** 2 - along ** 2;
  if (perp2 > TRUNK_R ** 2) return null;
  return along - Math.sqrt(TRUNK_R ** 2 - perp2);
}

// Куда встанет пила, если приставить её сейчас: точка на коре под прицелом, полотно горизонтально.
// Если рядом начатый пропил того же направления, пила встаёт в него.
function sawCandidate(forward) {
  const bark = distanceToBark(forward);
  if (bark === null || bark > REACH) return null;
  const origin = player.pos.clone().addScaledVector(forward, bark);
  origin.y = THREE.MathUtils.clamp(EYE + Math.tan(player.pitch) * bark, 0.05, ZONE_H - 0.05);
  const fresh = { origin, yaw: player.yaw, tilt: 0, depth: 0 };
  const freshNormal = basis(fresh).normal;
  return round.cuts.find((c) => {
    const { normal } = basis(c);
    return normal.dot(freshNormal) > SNAP_COS
      && forwardOf(c.yaw).dot(forward) > SNAP_COS
      && Math.abs(origin.clone().sub(c.origin).dot(normal)) < SNAP_DIST;
  }) ?? fresh;
}

function placeSaw(cut) {
  const b = basis(cut);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(b.side, b.along, b.normal),
  );
  aimPlane.quaternion.copy(rotation);
  aimPlane.position.copy(b.origin).addScaledVector(b.along, TRUNK_R);
  bar.quaternion.copy(rotation);
  bar.position.copy(b.origin).addScaledVector(b.along, cut.depth);
}

// Дерево перекидывается через недопил: падает в ту сторону, куда недопил смещён от оси.
// Недопил по центру или его нет вовсе — направление не задал никто, дерево решает само.
function startFall(layer) {
  const { voxels } = round;
  const rest = voxels.layerCentroid(layer);
  const off = Math.hypot(rest.x, rest.z);
  const f = off > 0.05 * TRUNK_R
    ? new THREE.Vector3(rest.x / off, 0, rest.z / off)
    : dirOf(Math.random() * Math.PI * 2);
  const edge = voxels.farthestAlong(layer, f);
  const h = (layer + 1) * VOXEL;

  round.upper.add(voxels.split(layer).group);
  const pivot = new THREE.Group();
  pivot.position.copy(f).multiplyScalar(edge).setY(h);
  round.root.add(pivot);
  pivot.attach(round.upper);

  round.pivot = pivot;
  round.fallDir = f;
  round.fallLen = TREE_H - h;
  round.axis = new THREE.Vector3(0, 1, 0).cross(f);
  round.angle = 0.03;
  mode = 'free';
  saw = null;
}

function land() {
  round.done = true;
  // Пришибло, если стоял там, куда лёг ствол: впереди недопила по линии падения и не дальше метра вбок.
  const f = round.fallDir;
  const dx = player.pos.x - round.pivot.position.x;
  const dz = player.pos.z - round.pivot.position.z;
  const along = dx * f.x + dz * f.z;
  const squashed = along > 0 && along < round.fallLen && Math.abs(dx * f.z - dz * f.x) < 1;
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

function update(dt) {
  const forward = forwardOf(player.yaw);
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  // Ходить можно, только пока пила не приставлена к стволу.
  const move = new THREE.Vector3();
  if (mode === 'free') {
    if (keys.has('KeyW')) move.add(forward);
    if (keys.has('KeyS')) move.sub(forward);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
  }
  const moving = move.lengthSq() > 0;
  if (moving) {
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6 : 3;
    player.pos.addScaledVector(move.normalize(), speed * dt);
  }
  // Сквозь пень не пройти.
  const minDist = TRUNK_R + 0.35;
  const dist = Math.hypot(player.pos.x, player.pos.z);
  if (dist < minDist) player.pos.multiplyScalar(minDist / dist);

  const candidate = mode === 'free' && !round.pivot ? sawCandidate(forward) : null;

  if (mode === 'cut') {
    if (!round.cuts.includes(saw)) round.cuts.push(saw);
    saw.depth = Math.min(saw.depth + SAW_SPEED * dt, 2 * TRUNK_R);
    round.voxels.carve(basis(saw), saw.depth, BAR_L);
    round.voxels.remesh();
    const weak = round.voxels.weakest();
    if (weak.share < HOLD) startFall(weak.layer);
  }

  const shown = saw ?? candidate;
  aimPlane.visible = Boolean(shown) && mode !== 'cut';
  bar.visible = Boolean(shown);
  if (shown) placeSaw(shown);

  if (round.pivot && !round.done) {
    // Падение стержня вокруг конца: угловое ускорение растёт с наклоном, поэтому сначала медленно, потом резко.
    round.speed += (3 * G / (2 * round.fallLen)) * Math.sin(round.angle) * dt;
    round.angle = Math.min(round.angle + round.speed * dt, Math.PI / 2);
    round.pivot.quaternion.setFromAxisAngle(round.axis, round.angle);
    if (round.angle === Math.PI / 2) land();
  }

  hintEl.textContent = hint(candidate);
  depthEl.style.visibility = saw ? 'visible' : 'hidden';
  if (saw) depthFillEl.style.width = `${(saw.depth / (2 * TRUNK_R)) * 100}%`;

  drawSection(forward, right, shown);

  let hx = 0, hy = 0;
  if (mode === 'cut') {
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

function hint(candidate) {
  if (round.pivot) return round.done ? '' : 'Падает! Беги!';
  if (mode === 'cut') return '';
  if (mode === 'aim') {
    if (saw.depth > 0) return 'ЛКМ — пилить дальше · S — убрать пилу';
    const tilt = Math.round(THREE.MathUtils.radToDeg(saw.tilt));
    return `Наклон ${tilt}° · мышь — наклон и поворот · ЛКМ — пилить · S — убрать пилу`;
  }
  if (!candidate) return round.cuts.length ? '' : 'Подойди к стволу';
  return round.cuts.includes(candidate) ? 'ЛКМ — приставить пилу к пропилу' : 'ЛКМ — приставить пилу';
}

// Схема слоя ствола сверху, развёрнутая по взгляду: ты всегда снизу.
// Светлое — древесина, тёмное — выпилено. Показан слой под пилой, а без пилы — самый тонкий.
const layerCanvas = document.createElement('canvas');
const layerCtx = layerCanvas.getContext('2d');

function drawSection(forward, right, shown) {
  const { voxels } = round;
  const { n } = voxels;
  const layer = shown ? voxels.layerOf(shown.origin.y) : voxels.weakest().layer;
  layerCanvas.width = layerCanvas.height = n;
  const img = layerCtx.createImageData(n, n);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      if (!voxels.inside[k * n + i]) continue;
      img.data.set(voxels.at(i, layer, k) ? [226, 191, 134, 255] : [42, 26, 14, 255], (k * n + i) * 4);
    }
  }
  layerCtx.putImageData(img, 0, 0);

  // Кубик (i, k) лежит в мире в (x, z); на экране x идёт вдоль right, z — против forward.
  const ctx = sectionCtx;
  const size = sectionEl.width;
  const scale = (size * 0.36) / TRUNK_R;
  const px = scale * VOXEL;
  const a = right.x * px, b = -forward.x * px, c = right.z * px, d = -forward.z * px;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(a, b, c, d, size / 2 - ((a + c) * n) / 2, size / 2 - ((b + d) * n) / 2);
  ctx.drawImage(layerCanvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const toScreen = (x, z) => [
    size / 2 + (x * right.x + z * right.z) * scale,
    size / 2 - (x * forward.x + z * forward.z) * scale,
  ];
  const target = dirOf(round.targetAz);
  ctx.strokeStyle = '#4cff6a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(...toScreen(target.x * TRUNK_R * 1.1, target.z * TRUNK_R * 1.1));
  ctx.lineTo(...toScreen(target.x * TRUNK_R * 1.35, target.z * TRUNK_R * 1.35));
  ctx.stroke();
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
  // S при приставленной пиле — шаг назад: пила убрана, ходить снова можно.
  if (e.code === 'KeyS' && mode !== 'free') {
    mode = 'free';
    saw = null;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
startEl.addEventListener('click', () => {
  startEl.hidden = true;
  lockPointer();
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) lockPointer();
  if (mode === 'aim') mode = 'cut';
  else if (mode === 'free' && !round.pivot) {
    saw = sawCandidate(forwardOf(player.yaw));
    if (saw) mode = 'aim';
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0 && mode === 'cut') mode = 'aim';
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && mode === 'cut') mode = 'aim';
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (mode === 'free') {
    player.yaw -= e.movementX * MOUSE;
    player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * MOUSE, -1.5, 1.5);
  } else if (mode === 'aim' && saw.depth === 0) {
    // Пока пила не вошла в древесину, мышь крутит полотно: вбок — поворот, вверх-вниз — наклон.
    const turn = THREE.MathUtils.clamp(angleDiff(saw.yaw - e.movementX * MOUSE, player.yaw), -MAX_TURN, MAX_TURN);
    saw.yaw = player.yaw + turn;
    saw.tilt = THREE.MathUtils.clamp(saw.tilt + e.movementY * MOUSE, -MAX_TILT, MAX_TILT);
  }
});

resize();
newRound();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  update(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
});
