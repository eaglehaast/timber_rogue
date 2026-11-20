import * as THREE from 'three';
import { MOUSE, fieldOfView, makePlayer, forwardOf, turnHead, walkInput, walkSpeed, stepEyes, eyeCamera, bindStick } from './player.js';
import { Body, World } from './bodies.js';
import { dressBark, dressLimbs } from './bark.js';
import { trunkShape, dressWood } from './trunk.js';
import { growMaple, barkGeometry, pointAt } from './maple.js';
import { Limb } from './limbs.js';
import { tiles, soften } from './surface.js';
import { Smoke } from './smoke.js';
import { generator, seed, random } from './random.js';

// Стенд «Костёр и поленница» (Шаг 4: Акварельный хоздвор):
// - Новая композиция: поленница прямо у забора (растёт влево), костёр справа, зона разгрузки перед поленницей.
// - Сзади — деревенский штакетник. Под всей рабочей зоной — акварельный плитняк (timber_yard_paving_01).
// - Акварельный костёр: зольное дно с углями (timber_yard_ash_decal.png), акварельные языки пламени (timber_yard_flames.png) и дым.
const HOLD_DROP_LOW = -0.32, PICK_RANGE = 3.6;
const PAVING_POS = new THREE.Vector3(-1.6, 0, -2.1), PAVING_HALF = { x: 6.6, z: 2.15 };
const PILE_POS = new THREE.Vector3(0, 0, -3.2), PILE_SIZE = { w: 2.4, d: 1.15, h: 1.85 };
const FIRE_POS = new THREE.Vector3(3.2, 0, -2.3), FIRE_SIDE = 2.7;
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

// Акварельные ассеты хоздвора: трава, мощение плитняком, зола кострища, обугленная кора головней и клубы пламени
const [grassTex, pavingTex, ashDecalTex, charredBarkTex, firePuffsTex] = tiles([
  'assets/textures/grass-clover.jpg',
  'assets/textures/yard/timber_yard_paving_01.jpg',
  'assets/textures/yard/timber_yard_ash_decal.png',
  'assets/textures/yard/timber_yard_charred_bark.jpg',
  'assets/textures/yard/timber_yard_fire_puffs.png',
]);
ashDecalTex.wrapS = ashDecalTex.wrapT = THREE.ClampToEdgeWrapping;
firePuffsTex.wrapS = firePuffsTex.wrapT = THREE.ClampToEdgeWrapping;

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

// Единая площадка плитняка под всей рабочей зоной хоздвора (она же — вся зона приёмки с мягкой подсветкой)
function makeYardPaving() {
  const W = PAVING_HALF.x * 2, D = PAVING_HALF.z * 2;
  const map = pavingTex.clone();
  map.repeat.set(W / 2.0, D / 2.0); // 1 плитка = 2 × 2 м
  const mat = soften(new THREE.MeshLambertMaterial({ map, color: 0xffffff }), {
    contrast: 0.88, saturation: 0.75, scales: [0.15, 0.5], low: [0.92, 0.9, 0.86], high: [1.06, 1.05, 1.02], cells: [1, 1],
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(PAVING_POS.x, 0.004, PAVING_POS.z);
  mesh.receiveShadow = true;
  return { mesh, mat };
}

// Деревенский штакетник вдоль задней границы хоздвора
function buildBackFence() {
  const group = new THREE.Group();
  const z = -4.25, startX = -9.2, endX = 5.2, step = 0.13;
  for (const h of [0.45, 1.35]) {
    const rail = new THREE.Mesh(makeBoardBox(endX - startX, 0.07, 0.04), boardMat);
    rail.position.set((startX + endX) / 2, h, z - 0.035);
    rail.castShadow = true;
    group.add(rail);
  }
  for (let x = startX; x <= endX; x += step) {
    const h = 1.75 + Math.sin(x * 3.7) * 0.04;
    const picket = new THREE.Mesh(makeBoardBox(0.10, h, 0.025), boardMat);
    picket.position.set(x, h / 2, z);
    picket.castShadow = picket.receiveShadow = true;
    group.add(picket);
  }
  return group;
}

// Цилиндрический тензор инерции тела массы m, радиуса r и длины L вдоль локальной оси Z тела.
function rodInertia(m, r, L) {
  const iz = Math.max(0.05, 0.5 * m * r * r), ixy = Math.max(0.05, (m * (3 * r * r + L * L)) / 12);
  return new THREE.Matrix3().set(ixy, 0, 0, 0, ixy, 0, 0, 0, iz);
}

// Строит настоящую игровую ось бревна клёна для barkGeometry вдоль локальной оси Z (от 0 до length):
// t = (0, 0, 1), n = (1, 0, 0), b = t × n = (0, 1, 0) — строгая правая тройка векторов (как в makeAxis в src/maple.js),
// чтобы грани трубки и торцов не выворачивались наизнанку, а кора ложилась по (phi * a.mean) / BARK_TILE и q.s / BARK_TILE.
function makeLogAxis(length, radius, seedPhase = 0) {
  const steps = Math.max(4, Math.ceil(length / 0.05));
  const points = [];
  const t = new THREE.Vector3(0, 0, 1);
  const n = new THREE.Vector3(1, 0, 0);
  const b = new THREE.Vector3(0, 1, 0); // t × n
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, s = u * length;
    const taper = 1 - 0.04 * u;
    points.push({
      s,
      p: new THREE.Vector3(0, 0, s),
      t: t.clone(),
      n: n.clone(),
      b: b.clone(),
      r: radius * taper,
    });
  }
  const profile = (az, s) => 1 + 0.035 * Math.cos(2 * az + seedPhase) + 0.02 * Math.sin(3 * az - seedPhase + s * 2);
  return {
    id: 0, stem: 0, parent: null, attach: 0, joint: 'trunk', level: 0, dead: false,
    included: 0, includedTo: 0, len: length, points, profile, children: [],
  };
}

// Анализирует любое настоящее игровое тело отпила (body с body.limb из src/main.js):
// находит главную ось (mainPart), вектор направления между спилами (cutDir), длину, вес и наличие боковых веточек.
function classifyLimbBody(body) {
  const { limb } = body;
  const mainPart = limb.parts[0];
  const p0 = pointAt(mainPart.axis, mainPart.from), p1 = pointAt(mainPart.axis, mainPart.to);
  const cutVec = p1.p.clone().sub(p0.p);
  const length = mainPart.to - mainPart.from;
  const cutDir = cutVec.lengthSq() > 1e-6 ? cutVec.normalize() : new THREE.Vector3(0, 0, 1);
  const radius = (p0.r + p1.r) / 2;
  const mass = Math.round(limb.weight.mass * 10) / 10;
  const cm = Math.round(length * 100);

  // Боковые оси на этом куске: мелкие веточки (до 55 см и тоньше 2.5 см) откусываются при укладке в поленницу,
  // а крупные развилки делают кусок веткой для костра.
  const sideParts = limb.parts.slice(1);
  const hasMajorFork = sideParts.some((p) => (p.to - p.from) > 0.55 || pointAt(p.axis, p.from).r > 0.028);
  const isLog = radius >= 0.055 && !hasMajorFork;
  const minorTwigs = isLog ? sideParts.length : 0;

  const tooHeavy = isLog ? cm > 100 || mass > MAX_LIFT_KG : mass > MAX_LIFT_KG;
  const fitsPile = isLog && !tooHeavy && cm >= 50 && cm <= 100;
  const kind = !isLog ? (cm <= 40 && mass < 2.5 ? 'twig' : 'branch') : 'log';

  const title = tooHeavy
    ? `Тяжёлое бревно (${cm} см, ${mass} кг)`
    : kind === 'twig'
      ? `Откушенная мелкая ветка с листвой (${cm} см)`
      : kind === 'branch'
        ? `Ветвь клёна с листвой (~${cm} см, ${mass} кг)`
        : minorTwigs > 0
          ? `Бревно с веточками (${cm} см, ${mass} кг)`
          : `Бревно (${cm} см, ${mass} кг)`;

  const verdict = tooHeavy
    ? 'Бревно тяжёлое — распили на части!'
    : fitsPile
      ? (minorTwigs > 0 ? 'В поленницу (50–100 см) · мелкие веточки с листвой откусятся для костра' : 'Подходит в поленницу (50–100 см)')
      : kind === 'twig'
        ? 'Мелкая ветка от полена → осталась в зоне приёмки для костра'
        : kind === 'branch'
          ? `Крупная ветка (${mass} кг) → в костёр (горит с дымом)`
          : `Короткий чурбак (${cm} см < 50 см) → пойдёт в костёр`;

  body.wood = {
    kind, length, cm, radius, mass, cutDir,
    twigs: minorTwigs, fitsPile, tooHeavy,
    holdDist: kind === 'branch' ? THREE.MathUtils.clamp(1.6 + body.reach * 0.45, 1.7, 2.45) : 1.65,
    title, verdict,
  };
  return body;
}

// Игровая функция создания физического тела Body из любого отпиленного куска Limb (один-в-один с limbBody в src/main.js).
function createLimbBody(world, scene, limb, position, quaternion) {
  const { mass, com, inertia } = limb.weight;
  const object = new THREE.Group();
  limb.group.position.copy(com).negate();
  limb.group.quaternion.identity();
  object.add(limb.group);
  scene.add(object);

  const capsules = limb.shape.map((c) => ({
    a: c.a.clone().sub(com),
    b: c.b.clone().sub(com),
    r: Math.max(0.015, c.r),
    soft: c.soft,
    src: { limb, capsule: c },
  }));
  const body = new Body(object, {
    mass,
    inertia,
    position: position.clone(),
    quaternion: quaternion.clone(),
    capsules,
  });
  body.limb = limb;
  classifyLimbBody(body);
  world.add(body);
  return body;
}

// Создаёт настоящее игровое бревно как Limb (со стволовой осью вдоль Z и, при twigs > 0, живыми боковыми веточками и листьями).
function createLogItem(world, scene, { length, radius, twigs = 0, pos, yaw = 0 }) {
  const axis = makeLogAxis(length, radius, pos.x * 3.1 + pos.z * 1.7 + length * 5);
  const parts = [{ axis, from: 0, to: length, cutFrom: true, cutTo: true }];
  const cards = [];

  for (let i = 0; i < twigs; i++) {
    const tLen = 0.26 + (i % 2) * 0.08;
    const attachS = length * (0.22 + (i / Math.max(1, twigs - 1)) * 0.56);
    const az = i * 2.2 + 0.7;
    const p0 = new THREE.Vector3(Math.cos(az) * (radius * 0.85), Math.sin(az) * (radius * 0.85), attachS);
    const dir = new THREE.Vector3(Math.cos(az) * 0.85, Math.sin(az) * 0.85, 0.42).normalize();
    const nVec = new THREE.Vector3(-dir.y, dir.x, 0).normalize();
    const bVec = dir.clone().cross(nVec).normalize(); // строгая правая тройка b = t × n
    const tPoints = [0, 0.33, 0.66, 1].map((u) => ({
      s: u * tLen,
      p: p0.clone().addScaledVector(dir, u * tLen),
      t: dir.clone(),
      n: nVec.clone(),
      b: bVec.clone(),
      r: Math.max(0.006, 0.016 * (1 - u * 0.65)),
    }));
    const twigAxis = {
      id: i + 1, parent: axis, attach: attachS, joint: 'twig', level: 2, dead: false,
      included: 0, includedTo: 0, len: tLen, points: tPoints, profile: null, children: [],
    };
    axis.children.push(twigAxis);
    parts.push({ axis: twigAxis, from: 0, to: tLen, cutFrom: false, cutTo: false });

    for (const u of [0.55, 0.85]) {
      const at = p0.clone().addScaledVector(dir, u * tLen);
      const up = dir.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize();
      const face = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
      cards.push({
        axis: twigAxis, s: u * tLen, at, up, face,
        cell: (i * 3 + Math.round(u * 10)) % 6, h: 0.22,
        center: at.clone().addScaledVector(up, 0.1), mass: 0.05,
      });
    }
  }

  const cloud = new THREE.Vector3(0, 0, length / 2);
  const limb = new Limb(parts, cards, { skin: limbSkin, cloud, zone: 0 }).dress();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return createLimbBody(world, scene, limb, pos, q);
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
  return pickedLimbs.slice(0, 4).map((limb, idx) => {
    const spot = branchSpots[idx % branchSpots.length];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, spot.yaw, 0.2, 'YXZ'));
    return createLimbBody(world, scene, limb, spot.pos, q);
  });
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


// Акварельный костёр хоздвора:
// - Зольное дно из timber_yard_ash_decal.png.
// - Обугленные тёмно-пепельные брёвна (barkGeometry, без ядовито-красного свечения).
// - Объёмный 3D-огонь по принципу дыма в src/smoke.js: клубы пламени (THREE.Sprite) поднимаются вверх, растут и тают в дым.
function buildCampfire(rnd) {
  const group = new THREE.Group(), S = FIRE_SIDE;
  const ashMat = new THREE.MeshLambertMaterial({
    map: ashDecalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  });
  const ashDecal = new THREE.Mesh(new THREE.PlaneGeometry(S, S), ashMat);
  ashDecal.rotation.x = -Math.PI / 2;
  ashDecal.position.y = 0.008;
  ashDecal.receiveShadow = true;
  group.add(ashDecal);

  // Обугленные головни в костре (barkGeometry с акварельной текстурой угля timber_yard_charred_bark.jpg и белым множителем цвета)
  const charBarkMat = new THREE.MeshLambertMaterial({ map: charredBarkTex, color: 0xffffff });
  const charEndMat = new THREE.MeshLambertMaterial({ map: charredBarkTex, color: 0xd8d2cc });
  const charSkin = [charBarkMat, charEndMat, charEndMat];
  const logSpecs = [
    { len: 1.35, r: 0.09,  x: -0.16, y: 0.09, z: -0.12, rx: 0.05,  ry: 0.4,   rz: 0.04 },
    { len: 1.45, r: 0.085, x: 0.14,  y: 0.11, z: 0.15,  rx: -0.06, ry: -0.58, rz: -0.05 },
    { len: 1.28, r: 0.08,  x: 0.0,   y: 0.16, z: -0.04, rx: 0.08,  ry: 1.15,  rz: 0.06 },
    { len: 1.18, r: 0.072, x: -0.20, y: 0.18, z: 0.12,  rx: -0.1,  ry: -0.95, rz: -0.08 },
    { len: 1.10, r: 0.068, x: 0.22,  y: 0.17, z: -0.18, rx: 0.09,  ry: 0.82,  rz: 0.05 },
  ];
  for (const l of logSpecs) {
    const axis = makeLogAxis(l.len, l.r, l.x * 5 + l.z * 3);
    const geo = barkGeometry([{ axis, from: 0, to: l.len, cutFrom: true, cutTo: true }]);
    geo.translate(0, 0, -l.len / 2);
    const log = new THREE.Mesh(geo, charSkin);
    log.position.set(l.x, l.y, l.z);
    log.rotation.set(l.rx, l.ry, l.rz);
    log.castShadow = log.receiveShadow = true;
    group.add(log);
  }

  // Нарезаем 8 объёмных клубов пламени из атласа timber_yard_fire_puffs.png (4 столбца × 2 строки, 512 × 512)
  const flameMaps = Array.from({ length: 8 }, (_, i) => {
    const col = i % 4, row = Math.floor(i / 4) % 2, m = firePuffsTex.clone();
    m.repeat.set(0.25, 0.5);
    m.offset.set(col * 0.25, row === 0 ? 0.5 : 0.0);
    m.needsUpdate = true;
    return m;
  });

  // 3D-система частиц огня по механизму src/smoke.js (THREE.Sprite):
  // Свободно парящие акварельные клубы огня рождаются над головнями, поднимаются вверх, поворачиваются, растут и тают в дым.
  const FIRE_PUFF = { count: 28, life: 1.35, rise: [0.85, 0.32], wind: [0.15, 0, 0.06], size: [0.46, 0.92] };
  const firePuffs = Array.from({ length: FIRE_PUFF.count }, (_, i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameMaps[i % 8], transparent: true, depthWrite: false, toneMapped: false,
    }));
    group.add(sprite);
    return { sprite, age: 0, base: new THREE.Vector3(), sway: 0, flip: 1, spin: 0 };
  });

  function renewFirePuff(p, age) {
    const k = Math.floor(rnd() * flameMaps.length), angle = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * 0.45;
    p.age = age;
    p.base.set(Math.cos(angle) * rad, 0.16 + rnd() * 0.10, Math.sin(angle) * rad);
    p.sway = rnd() * 6.28;
    p.flip = rnd() < 0.5 ? -1 : 1;
    p.spin = (rnd() - 0.5) * 0.9;
    p.sprite.material.map = flameMaps[k];
    p.sprite.material.rotation = (rnd() - 0.5) * 1.1;
  }
  firePuffs.forEach((p, i) => renewFirePuff(p, (i / FIRE_PUFF.count) * FIRE_PUFF.life));

  const light = new THREE.PointLight(0xff8c38, 3.2, 12);
  light.position.set(0, 0.85, 0);
  group.add(light);
  group.position.copy(FIRE_POS);

  const smoke = new Smoke(new THREE.Vector3(FIRE_POS.x, 0.82, FIRE_POS.z), rnd);
  const freshSmoke1 = new Smoke(new THREE.Vector3(FIRE_POS.x - 0.35, 0.70, FIRE_POS.z + 0.22), rnd);
  const freshSmoke2 = new Smoke(new THREE.Vector3(FIRE_POS.x + 0.35, 0.72, FIRE_POS.z - 0.22), rnd);
  const smokeGroup = new THREE.Group();
  smokeGroup.add(smoke, freshSmoke1, freshSmoke2);
  let smokeBoost = 0;

  const colPure = new THREE.Color(1.0, 1.0, 1.0);
  const colWarm = new THREE.Color(0.96, 0.78, 0.58);
  const colFade = new THREE.Color(0.55, 0.45, 0.40);

  function tick(dt, time, burningCount = 0) {
    const targetBoost = burningCount > 0 ? Math.min(1, 0.65 + burningCount * 0.25) : 0;
    smokeBoost += (targetBoost - smokeBoost) * (1 - Math.exp(-2.2 * dt));

    smoke.tick(dt * (1 + smokeBoost * 0.9));
    freshSmoke1.tick(dt * (0.6 + smokeBoost * 1.3));
    freshSmoke2.tick(dt * (0.6 + smokeBoost * 1.3));
    for (const extra of [freshSmoke1, freshSmoke2]) {
      extra.visible = smokeBoost > 0.02;
      for (const p of extra.puffs) {
        p.sprite.material.opacity *= smokeBoost * 1.35;
        p.sprite.scale.multiplyScalar(1 + smokeBoost * 0.35);
      }
    }

    const fireMult = 1 + smokeBoost * 0.38;
    light.intensity = (3.0 + 0.35 * Math.sin(time * 7.5) + 0.2 * Math.cos(time * 12.3)) * fireMult;

    const { life, rise: [r0, r1], wind, size: [s0, s1] } = FIRE_PUFF;
    for (const p of firePuffs) {
      p.age += dt;
      if (p.age >= life) renewFirePuff(p, p.age - life);
      const a = p.age, t = a / life;
      const up = (r0 * a + ((r1 - r0) * a * a) / (2 * life)) * fireMult;
      const wobble = 0.08 * t * Math.sin(time * 3.2 + p.sway);
      const s = (s0 + (s1 - s0) * Math.sqrt(t)) * fireMult;
      p.sprite.position.set(
        p.base.x * (1 - 0.28 * t) + wind[0] * a + wobble,
        p.base.y + up,
        p.base.z * (1 - 0.28 * t) + wind[2] * a,
      );
      p.sprite.scale.set(p.flip * s, s, 1);
      p.sprite.material.rotation += p.spin * dt;
      p.sprite.material.opacity = 0.85 * Math.min(1, a / 0.22) * (1 - t) ** 1.4;
      if (t < 0.6) p.sprite.material.color.copy(colPure).lerp(colWarm, t / 0.6);
      else p.sprite.material.color.copy(colWarm).lerp(colFade, (t - 0.6) / 0.4);
    }
  }
  return { group, smoke: smokeGroup, tick };
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
  const paving = makeYardPaving();
  scene.add(paving.mesh);
  scene.add(buildBackFence());

  const rnd = generator(42);
  const campfire = buildCampfire(rnd);
  scene.add(campfire.group, campfire.smoke);

  const worldRoot = new THREE.Group();
  scene.add(worldRoot);
  const world = new World(worldRoot, () => 0, (_x, _z, n) => n.set(0, 1, 0));

  // Менеджер секций поленницы: укладка сотами срезом к нам (+Z), по глубине поленья центрируются посередине поленницы.
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
    const baseY = 0.125 + SLOT_R, rowDy = SLOT_R * 1.74, zCenter = pos.z;
    for (let r = 0; r < PILE_ROWS; r++) {
      const odd = r % 2 === 1, cols = odd ? PILE_COLS - 1 : PILE_COLS, xOff = odd ? SLOT_R : 0;
      for (let c = 0; c < cols; c++) {
        slots.push({ x: innerLeft + xOff + c * (SLOT_R * 2.02), y: baseY + r * rowDy, zCenter });
      }
    }
    const pile = { index: idx + 1, pos, frame, slots, count: 0 };
    piles.push(pile);
    return pile;
  }

  const burningItems = [];

  function resetPiles() {
    while (piles.length) scene.remove(piles.pop().frame);
    while (stackedObjects.length) scene.remove(stackedObjects.pop());
    while (burningItems.length) scene.remove(burningItems.pop().object);
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
      { length: 0.60, radius: 0.095, twigs: 0, pos: new THREE.Vector3(-1.6, 0.14, 0.85), yaw: 0.15 },
      { length: 0.76, radius: 0.105, twigs: 4, pos: new THREE.Vector3(-0.5, 0.16, 0.95), yaw: -0.25 },
      { length: 0.92, radius: 0.105, twigs: 3, pos: new THREE.Vector3(0.65, 0.15, 0.85), yaw: 0.1 },
      { length: 0.54, radius: 0.095, twigs: 2, pos: new THREE.Vector3(-2.1, 0.14, 1.45), yaw: -0.15 },
      { length: 0.85, radius: 0.10,  twigs: 0, pos: new THREE.Vector3(0.05, 0.14, 1.55), yaw: 0.35 },
      { length: 0.34, radius: 0.095, twigs: 0, pos: new THREE.Vector3(-1.25, 0.13, 1.75), yaw: 0.6 },
      { length: 1.25, radius: 0.10,  twigs: 0, pos: new THREE.Vector3(1.55, 0.13, 1.45), yaw: -0.4 },
    ];
    for (const s of logSpecs) items.push(createLogItem(world, scene, s));
    items.push(...spawnRealMapleBranches(world, scene, branchSeed));
    branchSeed += 17;
  }
  spawnSampleItems(false);

  // Отправляет предмет (ветку, откушенные сучки или короткий чурбак < 50 см) в костёр, где он горит с дымом и сгорает.
  function sendToCampfire(body, customNotice = null) {
    const wIdx = world.bodies.indexOf(body);
    if (wIdx !== -1) world.bodies.splice(wIdx, 1);
    const iIdx = items.indexOf(body);
    if (iIdx !== -1) items.splice(iIdx, 1);

    const targetPos = new THREE.Vector3(
      FIRE_POS.x + (rnd() - 0.5) * 0.85,
      0.22 + rnd() * 0.12,
      FIRE_POS.z + (rnd() - 0.5) * 0.85,
    );
    const targetQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rnd() - 0.5) * 0.35, rnd() * Math.PI * 2, Math.PI / 2 + (rnd() - 0.5) * 0.35, 'YXZ'),
    );

    burningItems.push({
      object: body.object,
      title: body.wood.title,
      fromPos: body.position.clone(),
      fromQuat: body.quaternion.clone(),
      toPos: targetPos,
      toQuat: targetQuat,
      flyT: 0,
      flyDuration: 0.48,
      burnT: 0,
      burnDuration: body.wood.kind === 'twig' ? 4.2 : 6.8,
    });

    sayNotice(customNotice || `В костёр: ${body.wood.title} — свежая древесина горит с густым дымом!`);
  }

  // Приёмка подходящего полена (50–100 см) из зоны приёмки в поленницу (работает с любым игровым телом Limb).
  function acceptLogIntoWoodpile(body) {
    const wIdx = world.bodies.indexOf(body);
    if (wIdx !== -1) world.bodies.splice(wIdx, 1);
    const iIdx = items.indexOf(body);
    if (iIdx !== -1) items.splice(iIdx, 1);

    let snippedNote = '';
    if (body.limb && body.limb.parts.length > 1) {
      const sideParts = body.limb.parts.slice(1);
      const sideCards = body.limb.cards;
      const twigLimb = new Limb(sideParts, sideCards, {
        skin: body.limb.skin,
        cloud: body.limb.cloud,
        zone: 0,
      }).dress();
      const twigBody = createLimbBody(world, scene, twigLimb, body.position.clone(), body.quaternion.clone());
      sendToCampfire(twigBody);

      body.limb.parts = [body.limb.parts[0]];
      body.limb.cards = [];
      body.limb.dress();
      body.limb.group.position.copy(body.limb.weight.com).negate();
      classifyLimbBody(body);
      snippedNote = ' · мелкие веточки с листвой улетели в костёр';
    }

    let pile = piles[piles.length - 1];
    if (pile.count >= pile.slots.length) pile = addNewWoodpile();
    const slot = pile.slots[pile.count++];
    const spawnedNext = pile.count >= pile.slots.length;
    if (spawnedNext) addNewWoodpile();

    // Поленья центрируются по глубине поленницы (slot.zCenter), чтобы короткие не проваливались к дальнему краю
    const targetPos = new THREE.Vector3(slot.x, slot.y, slot.zCenter);
    const alignToZ = new THREE.Quaternion().setFromUnitVectors(body.wood.cutDir, new THREE.Vector3(0, 0, 1));
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (rnd() - 0.5) * Math.PI * 2);
    const targetQuat = rollQuat.multiply(alignToZ);

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

  const isInCampfire = (p) => Math.abs(p.x - FIRE_POS.x) <= FIRE_SIDE * 0.52 && Math.abs(p.z - FIRE_POS.z) <= FIRE_SIDE * 0.52;

  function processDropZone(droppedBody = null) {
    if (droppedBody) {
      if (isInDropZone(droppedBody.position)) {
        if (droppedBody.wood.fitsPile) acceptLogIntoWoodpile(droppedBody);
        else sendToCampfire(droppedBody);
        return;
      }
      if (!droppedBody.wood.fitsPile && isInCampfire(droppedBody.position)) {
        sendToCampfire(droppedBody);
        return;
      }
    }
    for (const b of [...items]) {
      if (b === held || b.wood.tooHeavy) continue;
      if (isInDropZone(b.position)) {
        if (b.wood.fitsPile) acceptLogIntoWoodpile(b);
        else sendToCampfire(b);
      } else if (!b.wood.fitsPile && isInCampfire(b.position)) {
        sendToCampfire(b);
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
  player.pos.set(0, 0, 2.2);
  const keys = new Set(), stick = bindStick(el('stick')), actionBtn = el('touch-saw');
  actionBtn.textContent = 'Взять / Бросить';

  let held = null, heldYawOffset = 0, aimed = null;
  const raycaster = new THREE.Raycaster(), centerNdc = new THREE.Vector2(0, 0);
  const holdTargetPos = new THREE.Vector3(), holdTargetQuat = new THREE.Quaternion(), viewDir = new THREE.Vector3();

  const isInDropZone = (p) => Math.abs(p.x - PAVING_POS.x) <= PAVING_HALF.x && Math.abs(p.z - PAVING_POS.z) <= PAVING_HALF.z;

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
    if (target.wood.tooHeavy) {
      sayNotice('Бревно тяжёлое — распили на части!', 3500);
      updateHudText();
      return;
    }
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
      // Мягкая подсветка всей плиточной зоны при взятии предмета и мягкий зеленоватый тон над плиткой
      paving.mat.color.setHex(overZone ? 0xc2d8b8 : 0xe8e2d4);
      crosshair.style.background = overZone ? '#b8e8a8' : '#9be89b';
      el('hint').textContent = overZone
        ? (held.wood.fitsPile ? `Отпусти ЛКМ → уложить в поленницу (${held.wood.cm} см)` : `Отпусти ЛКМ → отправить в костёр`)
        : `Несёшь: ${held.wood.title} (неси на плитку хоздвора)`;
      el('log').textContent = activeNotice || (overZone ? `Плитка хоздвора → ${held.wood.verdict}` : `${held.wood.verdict} · Занеси на плиточную площадку`);
      return;
    }
    paving.mat.color.setHex(0xffffff);
    if (aimed) {
      crosshair.style.background = aimed.wood.tooHeavy ? '#ff6b6b' : '#ffd15c';
      el('hint').textContent = aimed.wood.tooHeavy
        ? `${aimed.wood.title} — Бревно тяжёлое, распили на части!`
        : `${aimed.wood.title} — ЛКМ: взять`;
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
      pos: new THREE.Vector3(0, 0.35, -1.2),
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

    // Заходить в костёр нельзя (физическая граница вокруг квадрата костра без штрафов)
    const fireBlock = FIRE_SIDE * 0.46 + 0.35;
    const fdx = player.pos.x - FIRE_POS.x, fdz = player.pos.z - FIRE_POS.z;
    if (Math.abs(fdx) < fireBlock && Math.abs(fdz) < fireBlock) {
      if (fireBlock - Math.abs(fdx) < fireBlock - Math.abs(fdz)) {
        player.pos.x = FIRE_POS.x + (fdx >= 0 ? fireBlock : -fireBlock);
      } else {
        player.pos.z = FIRE_POS.z + (fdz >= 0 ? fireBlock : -fireBlock);
      }
    }

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

    // Перелёт веток/чурок в костёр и их сгорание с густым дымом (Шаг 3)
    for (let i = burningItems.length - 1; i >= 0; i--) {
      const b = burningItems[i];
      if (b.flyT < 1) {
        b.flyT = Math.min(1, b.flyT + dt / b.flyDuration);
        const ease = 1 - (1 - b.flyT) ** 3;
        b.object.position.lerpVectors(b.fromPos, b.toPos, ease);
        b.object.position.y += Math.sin(ease * Math.PI) * 0.45;
        b.object.quaternion.slerpQuaternions(b.fromQuat, b.toQuat, ease);
      } else {
        b.burnT += dt / b.burnDuration;
        const p = Math.min(1, b.burnT);
        const shrink = p < 0.55 ? 1 - p * 0.18 : Math.max(0.02, 0.9 - ((p - 0.55) / 0.45) * 0.88);
        b.object.scale.setScalar(shrink);
        b.object.position.y = b.toPos.y * shrink;
        if (b.burnT >= 1) {
          scene.remove(b.object);
          burningItems.splice(i, 1);
        }
      }
    }

    world.step(dt);
    processDropZone();
    campfire.tick(dt, elapsed, burningItems.length);
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
