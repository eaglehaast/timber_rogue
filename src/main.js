import * as THREE from 'three';

const TRUNK_R = 0.3;
const TREE_H = 12;
const REACH = 1.0;        // докуда достаёт шина пилы от лица до коры
const SAW_SPEED = 0.12;   // метров глубины в секунду
const HOLD = 0.2;         // доля сечения: если недопил меньше, дерево не держится
const CUT_MIN_Y = 0.3;
const CUT_MAX_Y = 1.3;
const SNAP_COS = Math.cos(THREE.MathUtils.degToRad(8));   // прицел прилипает к пропилу, если почти совпал
const SNAP_HEIGHT = 0.06;
const SAME_KERF = Math.cos(THREE.MathUtils.degToRad(20));
const TOLERANCE = THREE.MathUtils.degToRad(10);
const EYE = 1.7;
const G = 9.8;

// Сечение ствола — многоугольник; каждый пропил отрезает от него хорду.
const SECTION_SIDES = 64;
const FULL_SECTION = (SECTION_SIDES / 2) * TRUNK_R ** 2 * Math.sin((Math.PI * 2) / SECTION_SIDES);

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
const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f5d2a });
const kerfMat = new THREE.MeshBasicMaterial({ color: 0x1a0f08 });
const aimMat = new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.7 });
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

const aimMesh = new THREE.Mesh(new THREE.BufferGeometry(), aimMat);
aimMesh.rotation.order = 'YXZ';
scene.add(aimMesh);

// Кусок ствола между высотами y0 и y1; ствол сужается к вершине.
// У земли он ровно TRUNK_R и нигде не толще: по этому радиусу считаются пропилы, и их полоса должна выступать из коры.
function trunkPiece(y0, y1) {
  const radius = (y) => TRUNK_R * (1 - (0.4 * y) / TREE_H);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius(y1), radius(y0), y1 - y0, 24), barkMat);
  mesh.position.y = (y0 + y1) / 2;
  return mesh;
}

function newRound() {
  if (round) scene.remove(round.root);

  const trunk = trunkPiece(0, TREE_H);
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

  const root = new THREE.Group();
  root.add(upper, target);
  scene.add(root);

  round = {
    root, upper, trunk, targetAz,
    cuts: [], active: null,
    pivot: null, axis: null, fallDir: null, fallLen: 0, angle: 0, speed: 0,
    done: false,
  };
  resultEl.hidden = true;
}

// Пропил — плоская срезанная часть круга ствола: всё, что ближе к пильщику, чем хорда на глубине depth.
// Радиус чуть больше ствола, чтобы пропил проступал на коре полосой.
function shapeKerf(mesh, { dir, y, depth }, radius) {
  const chord = -TRUNK_R + depth;
  const a = Math.acos(THREE.MathUtils.clamp(chord / radius, -1, 1));
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, a, Math.PI * 2 - a, false);
  shape.closePath();
  mesh.geometry.dispose();
  mesh.geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  mesh.position.y = y;
  mesh.rotation.set(-Math.PI / 2, azimuthOf(dir), 0);
}

function addCut({ dir, y }) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), kerfMat);
  mesh.rotation.order = 'YXZ';
  round.root.add(mesh);
  const cut = { dir, y, depth: 0, mesh };
  round.cuts.push(cut);
  return cut;
}

// Что осталось от сечения после всех пропилов (в координатах x, z от оси ствола).
function section() {
  let poly = [];
  for (let i = 0; i < SECTION_SIDES; i++) {
    const a = (i / SECTION_SIDES) * Math.PI * 2;
    poly.push([Math.cos(a) * TRUNK_R, Math.sin(a) * TRUNK_R]);
  }
  for (const cut of round.cuts) poly = clip(poly, cut.dir.x, cut.dir.z, -TRUNK_R + cut.depth);
  return poly;
}

// Оставляет часть многоугольника, где p·n >= k.
function clip(poly, nx, nz, k) {
  const out = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const dp = p[0] * nx + p[1] * nz - k;
    const dq = q[0] * nx + q[1] * nz - k;
    if (dp >= 0) out.push(p);
    if (dp * dq < 0) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  });
  return out;
}

function areaAndCentroid(poly) {
  let a = 0, cx = 0, cz = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cz += (p[1] + q[1]) * cross;
  });
  if (a === 0) return { area: 0, x: 0, z: 0 };
  return { area: Math.abs(a / 2), x: cx / (3 * a), z: cz / (3 * a) };
}

// Дерево перекидывается через недопил: падает в ту сторону, куда недопил смещён от оси.
// Подпил с одной стороны и валочный пропил с другой оставляют недопил у подпила — туда и падение.
// Недопил по центру или его нет вовсе — направление не задал никто, дерево решает само.
function startFall(poly, rest) {
  const off = Math.hypot(rest.x, rest.z);
  const f = off > 0.05 * TRUNK_R
    ? new THREE.Vector3(rest.x / off, 0, rest.z / off)
    : dirOf(Math.random() * Math.PI * 2);
  const edge = poly.reduce((m, p) => Math.max(m, p[0] * f.x + p[1] * f.z), 0);
  const h = round.cuts.reduce((s, c) => s + c.y, 0) / round.cuts.length;

  round.trunk.removeFromParent();
  round.root.add(trunkPiece(0, h));
  round.upper.add(trunkPiece(h, TREE_H));

  const pivot = new THREE.Group();
  pivot.position.copy(f).multiplyScalar(edge).setY(h);
  round.root.add(pivot);
  pivot.attach(round.upper);

  round.pivot = pivot;
  round.fallDir = f;
  round.fallLen = TREE_H - h;
  round.axis = new THREE.Vector3(0, 1, 0).cross(f);
  round.angle = 0.03;
  round.active = null;
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

// Расстояние по взгляду до коры, если взгляд (по горизонтали) упирается в ствол.
function distanceToBark(forward) {
  const along = -(player.pos.x * forward.x + player.pos.z * forward.z);
  if (along <= 0) return null;
  const perp2 = player.pos.x ** 2 + player.pos.z ** 2 - along ** 2;
  if (perp2 > TRUNK_R ** 2) return null;
  return along - Math.sqrt(TRUNK_R ** 2 - perp2);
}

// Куда ляжет пропил: направление взгляда и высота, где прицел встречает кору.
// Если это почти совпадает с уже начатым пропилом, прицел встаёт в него.
function aimAt(forward) {
  const bark = distanceToBark(forward);
  if (bark === null || bark > REACH) return null;
  const y = THREE.MathUtils.clamp(EYE + Math.tan(player.pitch) * bark, CUT_MIN_Y, CUT_MAX_Y);
  const cut = round.cuts.find((c) => c.dir.dot(forward) > SNAP_COS && Math.abs(c.y - y) < SNAP_HEIGHT);
  return cut ?? { dir: forward.clone(), y, depth: 0 };
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

  const aim = round.pivot ? null : aimAt(forward);
  if (!sawing) round.active = null;
  else if (!round.active && aim) round.active = round.cuts.includes(aim) ? aim : addCut(aim);

  const active = round.active;
  const aligned = !active || forward.dot(active.dir) > SAME_KERF;
  const cutting = active && aim && aligned;
  if (cutting) {
    active.depth = Math.min(active.depth + SAW_SPEED * dt, TRUNK_R * 2);
    shapeKerf(active.mesh, active, TRUNK_R * 1.03);
    const poly = section();
    const rest = areaAndCentroid(poly);
    if (rest.area < HOLD * FULL_SECTION) startFall(poly, rest);
  }

  aimMesh.visible = Boolean(aim) && !active;
  if (aimMesh.visible) shapeKerf(aimMesh, { ...aim, depth: Math.max(aim.depth, 0.04) + 0.005 }, TRUNK_R * 1.06);

  if (round.pivot && !round.done) {
    // Падение стержня вокруг конца: угловое ускорение растёт с наклоном, поэтому сначала медленно, потом резко.
    round.speed += (3 * G / (2 * round.fallLen)) * Math.sin(round.angle) * dt;
    round.angle = Math.min(round.angle + round.speed * dt, Math.PI / 2);
    round.pivot.quaternion.setFromAxisAngle(round.axis, round.angle);
    if (round.angle === Math.PI / 2) land();
  }

  if (round.pivot) hintEl.textContent = round.done ? '' : 'Падает! Беги!';
  else if (active && !aligned) hintEl.textContent = 'Пили в тот же пропил';
  else if (active) hintEl.textContent = '';
  else if (!aim) hintEl.textContent = round.cuts.length ? '' : 'Подойди к стволу';
  else if (round.cuts.includes(aim)) hintEl.textContent = 'ЛКМ — продолжить пропил';
  else hintEl.textContent = 'ЛКМ — новый пропил';

  const shown = active ?? aim;
  depthEl.style.visibility = shown && !round.pivot ? 'visible' : 'hidden';
  if (shown) depthFillEl.style.width = `${(shown.depth / (TRUNK_R * 2)) * 100}%`;

  drawSection(forward, right, aim);

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

// Схема сечения сверху, развёрнутая по взгляду: ты всегда снизу.
// Светлое — недопил, тёмное — выпиленное, оранжевая линия — куда ляжет пропил, зелёная — цель.
function drawSection(forward, right, aim) {
  const ctx = sectionCtx;
  const size = sectionEl.width;
  const scale = (size * 0.36) / TRUNK_R;
  const toScreen = (x, z) => [
    size / 2 + (x * right.x + z * right.z) * scale,
    size / 2 - (x * forward.x + z * forward.z) * scale,
  ];

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#2a1a0e';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, TRUNK_R * scale, 0, Math.PI * 2);
  ctx.fill();

  const poly = section();
  ctx.fillStyle = '#e2bf86';
  ctx.beginPath();
  poly.forEach(([x, z]) => ctx.lineTo(...toScreen(x, z)));
  ctx.fill();

  const target = dirOf(round.targetAz);
  ctx.strokeStyle = '#4cff6a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(...toScreen(target.x * TRUNK_R * 1.1, target.z * TRUNK_R * 1.1));
  ctx.lineTo(...toScreen(target.x * TRUNK_R * 1.35, target.z * TRUNK_R * 1.35));
  ctx.stroke();

  if (aim && !round.active) {
    const u = -TRUNK_R + Math.max(aim.depth, 0.01);
    const w = Math.sqrt(TRUNK_R ** 2 - u ** 2);
    const side = new THREE.Vector3(-aim.dir.z, 0, aim.dir.x);
    ctx.strokeStyle = '#ff9a2e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(...toScreen(aim.dir.x * u + side.x * w, aim.dir.z * u + side.z * w));
    ctx.lineTo(...toScreen(aim.dir.x * u - side.x * w, aim.dir.z * u - side.z * w));
    ctx.stroke();
  }
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
  // Каждое нажатие заново выбирает пропил по прицелу, даже если между отпусканием и нажатием не прошло ни кадра.
  round.active = null;
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
