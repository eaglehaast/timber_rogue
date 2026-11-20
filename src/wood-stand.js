import * as THREE from 'three';
import { MOUSE, fieldOfView, makePlayer, forwardOf, turnHead, walkInput, walkSpeed, stepEyes, eyeCamera, bindStick } from './player.js';
import { Body, World } from './bodies.js';
import { dressBark, dressLimbs } from './bark.js';
import { trunkShape, dressWood } from './trunk.js';
import { growMaple, barkGeometry } from './maple.js';
import { Limb } from './limbs.js';
import { tiles, soften } from './surface.js';
import { Smoke } from './smoke.js';
import { generator, seed, random } from './random.js';

// Стенд «Костёр и поленница» (Шаг 1 с правками):
// - Игровая трава (grass-clover.jpg) и зона приёмки («трава чуть желтоватее»).
// - Увеличенная вдвое поленница из досок цвета забора (fence-board-1.jpg с шейдером забора).
// - Большой квадратный костёр для сжигания крупных веток (2.7 × 2.7 м, в 1.5 раза больше зоны приёмки, выложен камнями).
// - Настоящие игровые крупные ветки клёна с листвой (growMaple + Limb, весом до 45 кг) и брёвна.
const HOLD_DROP_LOW = -0.32, PICK_RANGE = 3.6;
const ZONE_POS = new THREE.Vector3(0, 0, -2.5), ZONE_HALF = { x: 0.9, z: 0.8 };
const PILE_POS = new THREE.Vector3(-2.75, 0, -2.5), PILE_SIZE = { w: 2.4, d: 1.15, h: 1.85 };
const FIRE_POS = new THREE.Vector3(2.95, 0, -2.5), FIRE_SIDE = 2.7;
const MAX_LIFT_KG = 45;

const barkMat = dressBark();
const woodMat = dressWood();
const limbSkin = [
  dressLimbs(barkMat),
  new THREE.MeshLambertMaterial({ map: woodMat.map }),
  new THREE.MeshLambertMaterial({ map: woodMat.userData.fibres }),
];

// Материал досок цвета забора (как в src/fence.js).
const FENCE_COLOR = 'vec3(0.12, 0.11, 0.1)', FENCE_PAINT = 'vec3(0.067, 0.24, 0.63)';
function makeFenceBoardMaterial() {
  const [map] = tiles(['assets/textures/fence-board-1.jpg']);
  const mat = new THREE.MeshLambertMaterial({ map });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float fenceLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = ${FENCE_COLOR} * fenceLuma / dot(${FENCE_PAINT}, vec3(0.299, 0.587, 0.114));`);
  };
  mat.customProgramCacheKey = () => 'woodpile-fence-board';
  return mat;
}
const boardMat = makeFenceBoardMaterial();

const [grassTex, mudTex] = tiles(['assets/textures/grass-clover.jpg', 'assets/textures/road-base.jpg']);
function makeGrassFloor(size) {
  const map = grassTex.clone();
  map.repeat.set(size / 2, size / 2);
  const mat = soften(new THREE.MeshLambertMaterial({ map }), {
    contrast: 0.85, saturation: 0.65, scales: [0.13, 0.5], low: [0.8, 0.84, 0.82], high: [0.98, 0.98, 0.95], cells: [5, 4],
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

// Цилиндрический тензор инерции тела массы m, радиуса r и длины L вдоль локальной оси Z тела.
function rodInertia(m, r, L) {
  const iz = Math.max(0.05, 0.5 * m * r * r), ixy = Math.max(0.05, (m * (3 * r * r + L * L)) / 12);
  return new THREE.Matrix3().set(ixy, 0, 0, 0, ixy, 0, 0, 0, iz);
}

// Строит настоящую игровую ось бревна клёна вдоль локальной оси Z (от -length/2 до +length/2) для barkGeometry:
// кора ложится в мировом масштабе, сечение чуть живое (эллипс с лёгкими наплывами), а оба торца — веер в полярных
// координатах с настоящими годовыми кольцами спила (end-grain-1..5.jpg).
function makeLogAxis(length, radius, seedPhase = 0) {
  const steps = Math.max(4, Math.ceil(length / 0.05));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, s = u * length, z = -length / 2 + s;
    const taper = 1 - 0.06 * u;
    points.push({
      s,
      p: new THREE.Vector3(0, 0, z),
      t: new THREE.Vector3(0, 0, 1),
      n: new THREE.Vector3(1, 0, 0),
      b: new THREE.Vector3(0, 1, 0),
      r: radius * taper,
    });
  }
  const profile = (az, s) => 1 + 0.045 * Math.cos(2 * az + seedPhase) + 0.025 * Math.sin(3 * az - seedPhase + s * 2);
  return {
    id: 0, parent: null, attach: 0, joint: 'trunk', level: 0, dead: false,
    included: 0, includedTo: 0, len: length, points, profile,
    bark: { radius, s: length, y: length },
  };
}

// Собирает мелкую веточку с листвой (которая сидит на бревне и «откусывается» в зоне приёмки).
function makeTwigMesh(tLen = 0.28) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.016, tLen, 7), limbSkin[0]);
  stem.castShadow = true;
  g.add(stem);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x5c7d3e, side: THREE.DoubleSide });
  for (let k = 0; k < 3; k++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.07), leafMat);
    const a = k * 2.1;
    leaf.position.set(Math.cos(a) * 0.04, tLen * (0.15 + k * 0.14), Math.sin(a) * 0.04);
    leaf.rotation.set(0.4, a, 0.3);
    g.add(leaf);
  }
  return g;
}

// Создаёт отдельное физическое тело для «откушенной» от полена мелкой ветки с листвой, остающейся в зоне приёмки.
function createSnippedTwigBody(world, scene, worldPos, yaw) {
  const length = 0.32, radius = 0.025, mass = 0.6;
  const group = new THREE.Group();
  const mesh = makeTwigMesh(length);
  mesh.rotation.x = Math.PI / 2;
  group.add(mesh);
  scene.add(group);
  const body = new Body(group, {
    mass,
    inertia: rodInertia(mass, radius, length),
    position: worldPos.clone(),
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    capsules: [{ a: new THREE.Vector3(0, 0, -0.12), b: new THREE.Vector3(0, 0, 0.12), r: radius }],
  });
  body.wood = {
    kind: 'twig', length, cm: 32, radius, mass, fitsPile: false, holdDist: 1.45,
    title: 'Откушенная мелкая ветка с листвой (32 см)',
    verdict: 'Мелкая ветка от полена → осталась в зоне приёмки для костра',
  };
  world.add(body);
  return body;
}

// Собирает настоящее игровое бревно-отпил ствола вдоль локальной оси Z (срез смотрит вдоль +Z и -Z).
function createLogItem(world, scene, { length, radius, twigs = 0, pos, yaw = 0 }) {
  const group = new THREE.Group();
  const axis = makeLogAxis(length, radius, pos.x * 3.1 + pos.z * 1.7 + length * 5);
  const geo = barkGeometry([{ axis, from: 0, to: length, cutFrom: true, cutTo: true }]);
  const trunkMesh = new THREE.Mesh(geo, limbSkin);
  trunkMesh.castShadow = trunkMesh.receiveShadow = true;
  group.add(trunkMesh);

  const twigGroup = new THREE.Group();
  for (let i = 0; i < twigs; i++) {
    const tLen = 0.24 + (i % 2) * 0.08;
    const mesh = makeTwigMesh(tLen);
    const z = (i / Math.max(1, twigs - 1) - 0.5) * (length * 0.62), a = i * 2.1 + 0.6;
    mesh.position.set(Math.cos(a) * (radius + tLen * 0.36), Math.sin(a) * (radius + tLen * 0.36), z);
    mesh.rotation.set((i % 2 ? 1 : -1) * 0.45, 0, -Math.sin(a) * 0.85);
    twigGroup.add(mesh);
  }
  if (twigs > 0) group.add(twigGroup);
  scene.add(group);

  const half = Math.max(0.02, length / 2 - radius);
  const mass = Math.round(Math.PI * radius * radius * length * 750 * 10) / 10;
  const body = new Body(group, {
    mass,
    inertia: rodInertia(mass, radius, length),
    position: pos.clone(),
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    capsules: [{ a: new THREE.Vector3(0, 0, -half), b: new THREE.Vector3(0, 0, half), r: radius }],
  });

  const cm = Math.round(length * 100), fitsPile = cm >= 50 && cm <= 100;
  body.wood = {
    kind: 'log', length, cm, radius, mass, twigs, twigGroup, fitsPile, holdDist: 1.65,
    title: twigs > 0 ? `Бревно с веточками (${cm} см, ${Math.round(mass)} кг)` : `Бревно (${cm} см, ${Math.round(mass)} кг)`,
    verdict: fitsPile
      ? (twigs > 0 ? 'В поленницу (50–100 см) · мелкие веточки с листвой откусятся для костра' : 'Подходит в поленницу (50–100 см)')
      : cm < 50 ? `Чурбак короче 50 см (${cm} см) → останется для костра` : `Длиннее 100 см (${cm} см) → не влезет в поленницу, для костра`,
  };
  world.add(body);
  return body;
}

// Выращивает настоящий игровой клён (growMaple) и отрезает от него крупные ветви с листвой (Limb) весом до 45 кг.
function spawnRealMapleBranches(world, scene, treeSeed = 107) {
  seed(treeSeed);
  const ZONE_H = 3.2, TREE_H = 11.5;
  const shape = trunkShape(0.24, ZONE_H, random() * Math.PI * 2);
  const { crowns } = growMaple(shape, ZONE_H, TREE_H, ZONE_H - 0.03);
  const c = crowns[0];
  const crown = new Limb(c.parts, c.cards, { skin: limbSkin, cloud: c.cloud, zone: ZONE_H }).dress();

  const pickedLimbs = [];
  for (const l of c.lows) {
    const lowLimb = new Limb(l.parts, l.cards, { skin: limbSkin, cloud: l.cloud, zone: ZONE_H }).dress();
    if (lowLimb.weight.mass >= 1.5 && lowLimb.weight.mass <= MAX_LIFT_KG && lowLimb.shape.length > 0) {
      pickedLimbs.push(lowLimb);
    }
  }
  const branchAxes = crown.parts.map((p) => p.axis).filter((a) => a.level === 1 || a.level === 2);
  for (const a of branchAxes) {
    if (pickedLimbs.length >= 4) break;
    if (!crown.parts.some((p) => p.axis === a && p.to - p.from > 0.4)) continue;
    const cutS = Math.min(a.len * 0.15, 0.25);
    const { mass } = crown.heft(a, cutS);
    if (mass >= 3.5 && mass <= MAX_LIFT_KG) {
      const piece = crown.split(a, cutS).dress();
      crown.dress();
      if (piece.shape.length > 0 && piece.weight.mass > 1.5) pickedLimbs.push(piece);
    }
  }

  const branchSpots = [
    { pos: new THREE.Vector3(-2.3, 0.55, 2.2), yaw: 0.4 },
    { pos: new THREE.Vector3(0.2, 0.6, 2.5), yaw: -0.8 },
    { pos: new THREE.Vector3(2.5, 0.55, 2.1), yaw: 1.2 },
    { pos: new THREE.Vector3(-0.9, 0.5, 3.6), yaw: -0.3 },
  ];
  const created = [];
  pickedLimbs.slice(0, 4).forEach((limb, idx) => {
    const { mass, com, inertia } = limb.weight;
    const object = new THREE.Group();
    limb.group.position.copy(com).negate();
    limb.group.quaternion.identity();
    object.add(limb.group);
    scene.add(object);

    const capsules = limb.shape.map((cap) => ({
      a: cap.a.clone().sub(com),
      b: cap.b.clone().sub(com),
      r: Math.max(0.015, cap.r),
    }));
    const spot = branchSpots[idx % branchSpots.length];
    const body = new Body(object, {
      mass, inertia, position: spot.pos.clone(),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, spot.yaw, 0.2, 'YXZ')),
      capsules,
    });
    body.limb = limb;

    const mainLen = Math.max(...limb.parts.map((p) => p.to - p.from));
    const spanM = Math.min(2.6, Math.max(mainLen, body.reach * 1.6));
    const cm = Math.round(spanM * 100), kg = Math.round(mass * 10) / 10;
    body.wood = {
      kind: 'branch', length: spanM, cm, radius: 0.06, mass: kg, fitsPile: false,
      holdDist: THREE.MathUtils.clamp(1.6 + body.reach * 0.45, 1.7, 2.45),
      title: `Ветвь клёна с листвой (~${cm} см, ${kg} кг)`,
      verdict: `Крупная ветка (${kg} кг, нести можно до ${MAX_LIFT_KG} кг) → в костёр (горит с дымом)`,
    };
    world.add(body);
    created.push(body);
  });
  return created;
}

// Брусок доски с правильной развёрткой UV (как block в src/fence.js), чтобы текстура забора не тянулась.
function makeBoardBox(sx, sy, sz) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv;
  const span = Math.max(sx, sy, sz);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * (span / 0.7));
  return geo;
}

// Увеличенная поленница из досок цвета забора, открытая спереди (+Z), в позиции pos.
// Крыша наклонена вперёд на угол roofPitch, а задние столбики выше передних и точно подпирают крышу.
function buildWoodpileFrame(pos = PILE_POS) {
  const group = new THREE.Group();
  const { w: W, d: D, h: H } = PILE_SIZE, T = 0.045;
  const roofPitch = 0.08, roofMidY = H + 0.06;
  const roofYAt = (z) => roofMidY - z * Math.tan(roofPitch);
  const box = (w, h, d, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(makeBoardBox(w, h, d), boardMat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  // Нижний настил
  box(W, 0.08, 0.1, 0, 0.04, -D * 0.38);
  box(W, 0.08, 0.1, 0, 0.04, D * 0.38);
  for (let i = -2; i <= 2; i++) box(W - 0.04, T, 0.19, 0, 0.08 + T / 2, i * 0.21);

  // Боковые угловые столбы (задние столбы sz === -1 выше передних и доходят прямо до крыши!) и наклонные стропила
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const zPost = sz * (D / 2 - 0.045);
      const hPost = roofYAt(zPost) - T * 0.5;
      box(0.09, hPost, 0.09, sx * (W / 2 - 0.045), hPost / 2, zPost);
    }
    for (let h = 0.26; h <= H - 0.12; h += 0.26) box(T, 0.16, D - 0.06, sx * (W / 2 - T / 2), h, 0);
    // Верхняя наклонная балка-стропило под скат крыши
    box(0.08, 0.07, D + 0.08, sx * (W / 2 - 0.045), roofMidY - 0.03, 0, roofPitch);
  }

  // Задний центральный столб (высокий, до заднего края крыши) и задние поперечные доски
  const zBackPost = -D / 2 + 0.045, hBackPost = roofYAt(zBackPost) - T * 0.5;
  box(0.09, hBackPost, 0.09, 0, hBackPost / 2, zBackPost);
  for (const h of [0.45, 0.95, 1.45, hBackPost - 0.08]) box(W, 0.14, T, 0, h, -D / 2 + T / 2);

  // Доски крыши по наклонным стропилам
  for (let i = -2; i <= 2; i++) {
    const z = i * 0.23;
    box(W + 0.2, T, 0.24, 0, roofYAt(z), z, roofPitch);
  }
  group.position.copy(pos);
  return group;
}

// Единая приёмная зона между поленницей и костром: «трава другого цвета — чуть желтоватее».
function buildDropZone() {
  const group = new THREE.Group(), W = ZONE_HALF.x * 2, D = ZONE_HALF.z * 2;
  const zoneMap = grassTex.clone();
  zoneMap.repeat.set(W / 2, D / 2);
  const padMat = soften(new THREE.MeshLambertMaterial({ map: zoneMap, color: 0xd8c878 }), {
    contrast: 0.85, saturation: 0.75, scales: [0.2, 0.6], low: [0.92, 0.88, 0.68], high: [1.08, 1.04, 0.82], cells: [5, 4],
  });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(W, D), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.006;
  pad.receiveShadow = true;
  group.add(pad);

  const bar = (w, d, x, z) => {
    const m = new THREE.Mesh(makeBoardBox(w, 0.03, d), boardMat);
    m.position.set(x, 0.015, z);
    m.receiveShadow = true;
    group.add(m);
  };
  bar(W, 0.05, 0, -D / 2 + 0.025);
  bar(W, 0.05, 0, D / 2 - 0.025);
  bar(0.05, D - 0.1, -W / 2 + 0.025, 0);
  bar(0.05, D - 0.1, W / 2 - 0.025, 0);
  group.position.copy(ZONE_POS);
  return { group, padMat };
}

// Большой квадратный костёр для сжигания крупных веток (2.7 × 2.7 м — в 1.5 раза больше зоны приёмки),
// выложенный по краям камнями, с грунтово-угольным дном, горящими поленьями, пламенем и дымом.
function buildCampfire(rnd) {
  const group = new THREE.Group();
  const S = FIRE_SIDE, half = S / 2;

  const pitMap = mudTex.clone();
  pitMap.repeat.set(1.2, 1.2);
  const pit = new THREE.Mesh(new THREE.BoxGeometry(S - 0.18, 0.03, S - 0.18), new THREE.MeshLambertMaterial({ map: pitMap, color: 0x3b281d }));
  pit.position.y = 0.015;
  pit.receiveShadow = true;
  group.add(pit);

  const ember = new THREE.Mesh(new THREE.BoxGeometry(S * 0.62, 0.045, S * 0.62), new THREE.MeshBasicMaterial({ color: 0x521d07 }));
  ember.position.y = 0.025;
  group.add(ember);

  const stoneMats = [
    new THREE.MeshLambertMaterial({ color: 0x686c66 }),
    new THREE.MeshLambertMaterial({ color: 0x555852 }),
    new THREE.MeshLambertMaterial({ color: 0x77756d }),
  ];
  const perSide = 11;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < perSide; i++) {
      const t = (i / perSide - 0.5) * (S - 0.14), jitter = (rnd() - 0.5) * 0.04;
      const x = side === 0 ? t : side === 1 ? half - 0.07 + jitter : side === 2 ? -t : -half + 0.07 + jitter;
      const z = side === 0 ? -half + 0.07 + jitter : side === 1 ? t : side === 2 ? half - 0.07 + jitter : -t;
      const r = 0.11 + rnd() * 0.045;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stoneMats[(i + side) % 3]);
      stone.position.set(x, r * 0.55, z);
      stone.scale.set(1.25, 0.72, 1.05);
      stone.rotation.set(rnd() * 0.4, rnd() * Math.PI, rnd() * 0.4);
      stone.castShadow = stone.receiveShadow = true;
      group.add(stone);
    }
  }

  const charMat = new THREE.MeshLambertMaterial({ color: 0x2f2016, emissive: 0x5e1e06 });
  const logSpecs = [
    { len: 1.55, r: 0.09, x: -0.2, y: 0.12, z: -0.15, rx: 0.08, ry: 0.35, rz: 1.52 },
    { len: 1.65, r: 0.085, x: 0.18, y: 0.14, z: 0.2, rx: -0.1, ry: -0.5, rz: 1.5 },
    { len: 1.45, r: 0.08, x: 0.0, y: 0.22, z: -0.05, rx: 0.15, ry: 1.2, rz: 1.42 },
    { len: 1.3, r: 0.07, x: -0.25, y: 0.25, z: 0.15, rx: -0.2, ry: -1.0, rz: 1.35 },
    { len: 1.2, r: 0.065, x: 0.28, y: 0.24, z: -0.22, rx: 0.22, ry: 0.8, rz: 1.32 },
  ];
  for (const l of logSpecs) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(l.r * 0.9, l.r, l.len, 10), charMat);
    log.position.set(l.x, l.y, l.z);
    log.rotation.set(l.rx, l.ry, l.rz);
    log.castShadow = true;
    group.add(log);
  }

  const flames = [], flameColors = [0xff5e14, 0xff9a22, 0xffcf54];
  for (let i = 0; i < 14; i++) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.13 + (i % 3) * 0.05, 0.52 + (i % 3) * 0.18, 6),
      new THREE.MeshBasicMaterial({ color: flameColors[i % flameColors.length] }),
    );
    const a = (i / 14) * Math.PI * 2, rad = i < 2 ? 0.08 : 0.25 + (i % 3) * 0.22;
    cone.position.set(Math.cos(a) * rad, 0.28 + (i % 2) * 0.06, Math.sin(a) * rad);
    group.add(cone);
    flames.push({ cone, baseH: cone.position.y, phase: i * 1.1 });
  }

  const light = new THREE.PointLight(0xff7b29, 3.2, 12);
  light.position.set(0, 0.85, 0);
  group.add(light);
  group.position.copy(FIRE_POS);

  const smoke = new Smoke(new THREE.Vector3(FIRE_POS.x, 0.75, FIRE_POS.z), rnd);
  function tick(dt, time) {
    smoke.tick(dt);
    light.intensity = 3.0 + 0.45 * Math.sin(time * 9.5) + 0.25 * Math.cos(time * 15.3);
    for (const f of flames) {
      const s = 0.85 + 0.26 * Math.sin(time * 10.5 + f.phase);
      f.cone.scale.set(1 + 0.14 * Math.cos(time * 8 + f.phase), s, 1 + 0.14 * Math.sin(time * 9 + f.phase));
      f.cone.position.y = f.baseH + (s - 1) * 0.11;
    }
  }
  return { group, smoke, tick };
}

export async function startWoodStand() {
  const el = (id) => document.getElementById(id);
  const canvas = el('scene'), renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(fieldOfView(), 800 / 460, 0.05, 140);
  scene.background = new THREE.Color(0xcbd8d1);
  scene.fog = new THREE.FogExp2(scene.background, 0.028);

  const hemi = new THREE.HemisphereLight(0xddeeff, 0x6e785f, 0.85);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.35);
  sun.position.set(8, 14, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(hemi, sun);

  scene.add(makeGrassFloor(140));

  const rnd = generator(42);
  const dropZone = buildDropZone(), campfire = buildCampfire(rnd);
  scene.add(dropZone.group, campfire.group, campfire.smoke);

  const worldRoot = new THREE.Group();
  scene.add(worldRoot);
  const world = new World(worldRoot, () => 0, (_x, _z, n) => n.set(0, 1, 0));

  // Менеджер секций поленницы (Шаг 2): укладка сотами срезом к нам (+Z) на глубину длины полена.
  const PILE_COLS = 10, PILE_ROWS = 8, SLOT_R = 0.105;
  const piles = [], flyingLogs = [];
  let stackedObjects = [], statusNotice = { text: '', until: 0 };
  const sayNotice = (text, ms = 5000) => { statusNotice = { text, until: performance.now() + ms }; };

  function addNewWoodpile() {
    const idx = piles.length, pos = PILE_POS.clone();
    pos.x -= idx * (PILE_SIZE.w + 0.22);
    const frame = buildWoodpileFrame(pos);
    scene.add(frame);
    const slots = [], innerLeft = pos.x - PILE_SIZE.w / 2 + 0.15 + SLOT_R;
    const baseY = 0.125 + SLOT_R, rowDy = SLOT_R * 1.74, zBack = pos.z - PILE_SIZE.d / 2 + 0.07;
    for (let r = 0; r < PILE_ROWS; r++) {
      const odd = r % 2 === 1, cols = odd ? PILE_COLS - 1 : PILE_COLS, xOff = odd ? SLOT_R : 0;
      for (let c = 0; c < cols; c++) {
        slots.push({ x: innerLeft + xOff + c * (SLOT_R * 2.02), y: baseY + r * rowDy, zBack });
      }
    }
    const pile = { index: idx + 1, pos, frame, slots, count: 0 };
    piles.push(pile);
    return pile;
  }

  function resetPiles() {
    while (piles.length) scene.remove(piles.pop().frame);
    while (stackedObjects.length) scene.remove(stackedObjects.pop());
    flyingLogs.length = 0;
    addNewWoodpile();
  }
  resetPiles();

  const items = [];
  let branchSeed = 107;
  function spawnSampleItems(resetStack = true) {
    while (items.length) scene.remove(items.pop().object);
    world.bodies.length = 0;
    if (resetStack) resetPiles();
    const logSpecs = [
      { length: 0.60, radius: 0.095, twigs: 0, pos: new THREE.Vector3(-1.6, 0.14, 0.4), yaw: 0.15 },
      { length: 0.76, radius: 0.105, twigs: 4, pos: new THREE.Vector3(-0.5, 0.16, 0.55), yaw: -0.25 },
      { length: 0.92, radius: 0.105, twigs: 3, pos: new THREE.Vector3(0.65, 0.15, 0.45), yaw: 0.1 },
      { length: 0.54, radius: 0.095, twigs: 2, pos: new THREE.Vector3(-2.1, 0.14, 1.1), yaw: -0.15 },
      { length: 0.85, radius: 0.10,  twigs: 0, pos: new THREE.Vector3(0.05, 0.14, 1.25), yaw: 0.35 },
      { length: 0.34, radius: 0.095, twigs: 0, pos: new THREE.Vector3(-1.25, 0.13, 1.45), yaw: 0.6 },
      { length: 1.25, radius: 0.10,  twigs: 0, pos: new THREE.Vector3(1.55, 0.13, 1.15), yaw: -0.4 },
    ];
    for (const s of logSpecs) items.push(createLogItem(world, scene, s));
    items.push(...spawnRealMapleBranches(world, scene, branchSeed));
    branchSeed += 17;
  }
  spawnSampleItems(false);

  // Приёмка подходящего полена (50–100 см) из зоны приёмки в поленницу.
  function acceptLogIntoWoodpile(body) {
    const wIdx = world.bodies.indexOf(body);
    if (wIdx !== -1) world.bodies.splice(wIdx, 1);
    const iIdx = items.indexOf(body);
    if (iIdx !== -1) items.splice(iIdx, 1);

    let snippedNote = '';
    if (body.wood.twigs > 0 && body.wood.twigGroup) {
      body.object.remove(body.wood.twigGroup);
      const twigCount = Math.min(2, body.wood.twigs);
      for (let i = 0; i < twigCount; i++) {
        const dropPos = new THREE.Vector3(
          ZONE_POS.x + (rnd() - 0.5) * 0.7,
          0.18 + i * 0.08,
          ZONE_POS.z + (rnd() - 0.5) * 0.5,
        );
        items.push(createSnippedTwigBody(world, scene, dropPos, rnd() * Math.PI));
      }
      body.wood.twigs = 0;
      snippedNote = ' · мелкая ветка с листвой ушла в остаток для костра';
    }

    let pile = piles[piles.length - 1];
    if (pile.count >= pile.slots.length) pile = addNewWoodpile();
    const slot = pile.slots[pile.count++];
    const spawnedNext = pile.count >= pile.slots.length;
    if (spawnedNext) addNewWoodpile();

    const targetPos = new THREE.Vector3(slot.x, slot.y, slot.zBack + body.wood.length / 2);
    // Ось полена теперь идёт вдоль локальной оси Z (срезы смотрят в +Z и -Z) → полено лежит строго горизонтально
    // вдоль оси Z, поворачиваясь только вокруг своей продольной оси Z на случайный угол roll!
    const roll = (rnd() - 0.5) * Math.PI * 2;
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll);

    stackedObjects.push(body.object);
    flyingLogs.push({
      object: body.object,
      fromPos: body.position.clone(),
      fromQuat: body.quaternion.clone(),
      toPos: targetPos,
      toQuat: targetQuat,
      t: 0,
      duration: 0.42,
    });

    const totalStacked = piles.reduce((sum, p) => sum + p.count, 0);
    el('gap').textContent = `В поленнице: ${totalStacked} шт. (поленниц: ${piles.length}) · P — тест: +полено`;
    sayNotice(
      spawnedNext
        ? `Поленница #${pile.index} заполнена! Рядом появилась новая поленница #${pile.index + 1}${snippedNote}`
        : `Полено ${body.wood.cm} см уложено в поленницу #${pile.index} срезом к нам${snippedNote}`,
    );
  }

  function processDropZone(droppedBody = null) {
    if (droppedBody && isInDropZone(droppedBody.position)) {
      if (droppedBody.wood.fitsPile) {
        acceptLogIntoWoodpile(droppedBody);
      } else {
        sayNotice(`Осталось в зоне приёмки (для костра): ${droppedBody.wood.title}`);
      }
      return;
    }
    for (const b of [...items]) {
      if (b !== held && b.wood.fitsPile && isInDropZone(b.position)) {
        acceptLogIntoWoodpile(b);
      }
    }
  }

  el('hud').classList.add('details');
  el('hud').hidden = false;
  el('held-saw').hidden = el('kit').hidden = el('side').hidden = el('depth').hidden = true;
  el('gap').hidden = false;
  el('gap').textContent = 'В поленнице: 0 шт. (поленниц: 1) · P — тест: +полено';
  Object.assign(el('back'), { href: './#stands', textContent: '← Стенды' });
  el('regrow').textContent = 'Сбросить брёвна (R)';

  const crosshair = document.createElement('div');
  Object.assign(crosshair.style, {
    position: 'absolute', left: '50%', top: '50%', width: '8px', height: '8px',
    marginLeft: '-4px', marginTop: '-4px', borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.85)', boxShadow: '0 0 0 1.5px rgba(24, 35, 31, 0.75)',
    pointerEvents: 'none', zIndex: '5',
  });
  el('hud').appendChild(crosshair);

  const player = makePlayer();
  player.pos.set(0, 0, 4.8);
  const keys = new Set(), stick = bindStick(el('stick')), actionBtn = el('touch-saw');
  actionBtn.textContent = 'Взять / Бросить';

  let held = null, heldYawOffset = 0, aimed = null;
  const raycaster = new THREE.Raycaster(), centerNdc = new THREE.Vector2(0, 0);
  const holdTargetPos = new THREE.Vector3(), holdTargetQuat = new THREE.Quaternion(), viewDir = new THREE.Vector3();

  const isInDropZone = (p) => Math.abs(p.x - ZONE_POS.x) <= ZONE_HALF.x && Math.abs(p.z - ZONE_POS.z) <= ZONE_HALF.z;

  function findAimedBody() {
    eyeCamera(camera, player);
    raycaster.setFromCamera(centerNdc, camera);
    let best = null, bestDist = PICK_RANGE;
    for (const b of items) {
      const hits = raycaster.intersectObject(b.object, true);
      if (hits.length > 0 && hits[0].distance < bestDist) {
        best = b;
        bestDist = hits[0].distance;
      }
    }
    return best;
  }

  function toggleHold() {
    if (held) {
      const dropped = held;
      held = null;
      world.add(dropped);
      dropped.velocity.set(0, 0, 0);
      dropped.spin.set(0, 0, 0);
      dropped.wake();
      processDropZone(dropped);
      updateHudText();
      return;
    }
    const target = findAimedBody();
    if (!target) return;
    const idx = world.bodies.indexOf(target);
    if (idx !== -1) world.bodies.splice(idx, 1);
    held = target;
    heldYawOffset = new THREE.Euler().setFromQuaternion(held.quaternion, 'YXZ').y - player.yaw;
    updateHudText();
  }

  function updateHudText() {
    const activeNotice = performance.now() < statusNotice.until ? statusNotice.text : '';
    if (held) {
      const overZone = isInDropZone(held.position);
      dropZone.padMat.color.setHex(overZone ? (held.wood.fitsPile ? 0xa9e36b : 0xf0a656) : 0xd8c878);
      crosshair.style.background = overZone ? '#ffd15c' : '#9be89b';
      el('hint').textContent = overZone
        ? (held.wood.fitsPile ? `Отпусти ЛКМ → уложить в поленницу (${held.wood.cm} см)` : `Отпусти ЛКМ → оставить в зоне для костра`)
        : `Несёшь: ${held.wood.title} (ЛКМ — положить)`;
      el('log').textContent = activeNotice || (overZone ? `Зона приёмки → ${held.wood.verdict}` : `${held.wood.verdict} · Неси в зону между поленницей и костром`);
      return;
    }
    dropZone.padMat.color.setHex(0xd8c878);
    if (aimed) {
      crosshair.style.background = '#ffd15c';
      el('hint').textContent = `${aimed.wood.title} — ЛКМ: взять`;
      el('log').textContent = activeNotice || aimed.wood.verdict;
    } else {
      crosshair.style.background = 'rgba(255, 255, 255, 0.85)';
      el('hint').textContent = '';
      if (activeNotice) {
        el('log').textContent = activeNotice;
        return;
      }
      const inZone = items.filter((b) => isInDropZone(b.position));
      if (inZone.length > 0) {
        const last = inZone[inZone.length - 1];
        el('log').textContent = `В зоне приёмки для костра (${inZone.length} шт.): ${last.wood.title}`;
      } else {
        el('log').textContent = 'Наведи точку на бревно или ветку и нажми ЛКМ · P — быстро добавить полено в поленницу';
      }
    }
  }

  let dragPointer = null, dragMoved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (document.pointerLockElement === canvas) { toggleHold(); return; }
    dragPointer = e.pointerId;
    dragMoved = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (document.pointerLockElement === canvas || dragPointer === e.pointerId) {
      if (dragPointer === e.pointerId) dragMoved += Math.hypot(e.movementX, e.movementY);
      turnHead(player, e.movementX * MOUSE, e.movementY * MOUSE);
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (e) => {
      if (dragPointer !== e.pointerId) return;
      const wasClick = dragMoved < 6;
      dragPointer = null;
      if (wasClick) {
        if (!document.body.classList.contains('touch') && canvas.requestPointerLock) canvas.requestPointerLock();
        toggleHold();
      }
    });
  }

  actionBtn.addEventListener('click', toggleHold);
  el('regrow').addEventListener('click', () => { held = null; spawnSampleItems(); });

  // Быстрое тестовое добавление полена (50–100 см) через зону приёмки по клавише P
  function quickSpawnLogToPile() {
    const length = 0.52 + rnd() * 0.46;
    const twigs = rnd() < 0.35 ? 2 : 0;
    const b = createLogItem(world, scene, {
      length,
      radius: 0.095 + rnd() * 0.012,
      twigs,
      pos: new THREE.Vector3(ZONE_POS.x, 0.35, ZONE_POS.z),
      yaw: 0,
    });
    items.push(b);
    acceptLogIntoWoodpile(b);
  }

  addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
    keys.add(e.code);
    if (e.code === 'KeyC' && !e.repeat) player.crouch = !player.crouch;
    if (e.code === 'KeyE' && !e.repeat) toggleHold();
    if (e.code === 'KeyP' && !e.repeat) quickSpawnLogToPile();
    if (e.code === 'KeyR' && !e.repeat) { held = null; spawnSampleItems(true); }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  let previous = performance.now(), elapsed = 0;
  function frame(now) {
    const dt = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    elapsed += dt;

    const input = walkInput(keys, stick), forward = forwardOf(player.yaw), right = new THREE.Vector3(-forward.z, 0, forward.x);
    const speed = walkSpeed(player, keys);
    player.pos.addScaledVector(forward, input.ahead * speed * dt).addScaledVector(right, input.side * speed * dt);
    player.pos.clampScalar(-35, 35);
    stepEyes(player, right, Math.hypot(input.side, input.ahead) * speed, dt);
    eyeCamera(camera, player);

    if (held) {
      camera.getWorldDirection(viewDir);
      holdTargetPos.copy(camera.position).addScaledVector(viewDir, held.wood.holdDist ?? 1.7);
      holdTargetPos.y += HOLD_DROP_LOW;
      const minHeight = Math.max(0.18, held.wood.radius + 0.08);
      if (holdTargetPos.y < minHeight) holdTargetPos.y = minHeight;

      const lerpFactor = 1 - Math.exp(-18 * dt);
      held.position.lerp(holdTargetPos, lerpFactor);
      holdTargetQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw + heldYawOffset);
      held.quaternion.slerp(holdTargetQuat, lerpFactor);
      held.place();
      aimed = null;
    } else {
      aimed = findAimedBody();
    }

    // Плавный перелёт принятых брёвен в соты поленницы
    for (let i = flyingLogs.length - 1; i >= 0; i--) {
      const f = flyingLogs[i];
      f.t = Math.min(1, f.t + dt / f.duration);
      const ease = 1 - (1 - f.t) ** 3;
      f.object.position.lerpVectors(f.fromPos, f.toPos, ease);
      f.object.position.y += Math.sin(ease * Math.PI) * 0.25;
      f.object.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, ease);
      if (f.t >= 1) flyingLogs.splice(i, 1);
    }

    world.step(dt);
    processDropZone();
    campfire.tick(dt, elapsed);
    updateHudText();
    renderer.render(scene, camera);
  }

  function resize() {
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  renderer.setAnimationLoop(frame);
}
