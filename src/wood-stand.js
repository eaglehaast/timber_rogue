import * as THREE from 'three';
import { MOUSE, fieldOfView, makePlayer, forwardOf, turnHead, walkInput, walkSpeed, stepEyes, eyeCamera, bindStick } from './player.js';
import { Body, World } from './bodies.js';
import { dressBark, dressLimbs } from './bark.js';
import { trunkShape, dressWood } from './trunk.js';
import { growMaple } from './maple.js';
import { Limb } from './limbs.js';
import { tiles, soften } from './surface.js';
import {
  HOLD_DROP_LOW, PICK_RANGE, PAVING_POS, PAVING_HALF, PILE_POS, PILE_SIZE, FIRE_POS, FIRE_SIDE,
  makeYardPaving, buildBackFence, buildWoodpileFrame, buildCampfire, scorchLimb, classifyLimbBody, dragBranch, haulSpeed,
} from './campfire.js';
import { isOnEmberBed } from './ember-bed.js';
import { generator, seed, random } from './random.js';

const barkMat = dressBark();
const woodMat = dressWood();
const limbSkin = [
  dressLimbs(barkMat),
  new THREE.MeshLambertMaterial({ map: woodMat.map }),
  new THREE.MeshLambertMaterial({ map: woodMat.userData.fibres }),
];

const [grassTex] = tiles(['assets/textures/grass-clover.jpg']);

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

// Выращивает игровой клён и отрезает от него ветви с листвой для стенда.
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
    if (lowLimb.weight.mass >= 1.5 && lowLimb.shape.length > 0) {
      pickedLimbs.push(lowLimb);
    }
  }
  const branchAxes = crown.parts.map((p) => p.axis).filter((a) => a.level === 1 || a.level === 2);
  for (const a of branchAxes) {
    if (pickedLimbs.length >= 4) break;
    if (!crown.parts.some((p) => p.axis === a && p.to - p.from > 0.4)) continue;
    const cutS = Math.min(a.len * 0.15, 0.25);
    const { mass } = crown.heft(a, cutS);
    if (mass >= 3.5) {
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
  const campfire = buildCampfire(FIRE_POS, FIRE_SIDE, generator(394));
  scene.add(campfire.group);

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

  function updatePileCount() {
    const count = piles.reduce((sum, pile) => sum + pile.count, 0);
    el('gap').textContent = `В поленнице · ${count}` + (piles.length > 1 ? ` / секций · ${piles.length}` : '');
  }

  function removeWood(object) {
    object.removeFromParent();
    object.traverse(child => child.geometry?.dispose());
  }

  function removeFuel(fuel) {
    removeWood(fuel.object);
    fuel.coating?.dispose();
  }

  function resetPiles() {
    while (piles.length) removeWood(piles.pop().frame);
    while (stackedObjects.length) removeWood(stackedObjects.pop());
    while (burningItems.length) removeFuel(burningItems.pop());
    campfire.reset();
    statusNotice.until = 0;
    flyingLogs.length = 0;
    addNewWoodpile();
    updatePileCount();
  }
  resetPiles();

  const items = [], droppedItems = new Set();
  let branchSeed = 107;
  function spawnSampleItems(resetStack = true) {
    while (items.length) removeWood(items.pop().object);
    world.bodies.length = 0;
    droppedItems.clear();
    if (resetStack) resetPiles();
    const logSpecs = [
      { length: 0.60, radius: 0.095, twigs: 0, pos: new THREE.Vector3(-1.6, 0.14, 0.85), yaw: 0.15 },
      { length: 0.76, radius: 0.105, twigs: 4, pos: new THREE.Vector3(-0.5, 0.16, 0.95), yaw: -0.25 },
      { length: 0.92, radius: 0.105, twigs: 3, pos: new THREE.Vector3(0.65, 0.15, 0.85), yaw: 0.1 },
      { length: 0.84, radius: 0.155, twigs: 0, pos: new THREE.Vector3(1.1, 0.18, 0.85), yaw: 0.25 }, // тяжёлый комель (~48 кг) — катится как колесо!
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

  // При броске над кучей сохраняем точку попадания, при сортировке на плитке выбираем место в костре.
  function sendToCampfire(body, customNotice = null) {
    const wIdx = world.bodies.indexOf(body);
    if (wIdx !== -1) world.bodies.splice(wIdx, 1);
    const iIdx = items.indexOf(body);
    if (iIdx !== -1) items.splice(iIdx, 1);

    const local = new THREE.Vector2(body.position.x - FIRE_POS.x, body.position.z - FIRE_POS.z);
    if (local.lengthSq() > 1.3 ** 2) local.set((rnd() - 0.5) * 0.87, (rnd() - 0.5) * 0.74);
    local.clampLength(0, 0.68);
    const support = campfire.heightAt(local.x, local.y);
    const targetPos = new THREE.Vector3(FIRE_POS.x + local.x, support + body.wood.radius, FIRE_POS.z + local.y);
    const yaw = rnd() * Math.PI * 2;
    const targetQuat = new THREE.Quaternion().setFromUnitVectors(body.wood.cutDir, new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)));

    burningItems.push({
      object: body.object, limb: body.limb, mass: body.limb.weight.mass, local,
      length: body.wood.length, reach: body.reach, yaw,
      fromPos: body.position.clone(), fromQuat: body.quaternion.clone(), toPos: targetPos, toQuat: targetQuat,
      flyT: 0, flyDuration: 0.48, burnT: 0, burnDuration: body.wood.kind === 'twig' ? 4.2 : 6.8,
      coating: null, deposited: false,
    });
    sayNotice(customNotice || `В костёр: ${body.wood.title}`);
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

      const cleanPart = { ...body.limb.parts[0], tongue: null, groove: null, cutFrom: true, cutTo: true };
      body.limb.parts = [cleanPart];
      body.limb.cards = [];
      body.limb.dress();
      body.limb.group.position.copy(body.limb.weight.com).negate();
      classifyLimbBody(body);
      snippedNote = ' · мелкие веточки с листвой улетели в костёр';
    }
    if (body.wood.radius > SLOT_R * 1.04) {
      const s = SLOT_R / body.wood.radius;
      const d = body.wood.cutDir;
      body.object.scale.set(
        Math.abs(d.x) > 0.7 ? 1 : s,
        Math.abs(d.y) > 0.7 ? 1 : s,
        Math.abs(d.z) > 0.7 ? 1 : s,
      );
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

    updatePileCount();
    sayNotice(
      spawnedNext
        ? `Поленница #${pile.index} заполнена! Рядом появилась новая поленница #${pile.index + 1}${snippedNote}`
        : `Полено ${body.wood.cm} см уложено в поленницу #${pile.index} срезом к нам${snippedNote}`,
    );
  }

  function dropZoneAt({ x, z }) {
    if (isOnEmberBed(x - FIRE_POS.x, z - FIRE_POS.z)) return 'embers';
    if (Math.abs(x - PAVING_POS.x) <= PAVING_HALF.x && Math.abs(z - PAVING_POS.z) <= PAVING_HALF.z) return 'paving';
    return null;
  }

  // Сортировке подлежит то, что отпустил игрок. Исходные образцы могут спокойно улечься на землю.
  function processDropZone() {
    for (const body of droppedItems) {
      const zone = dropZoneAt(body.position);
      if (!zone) continue;
      droppedItems.delete(body);
      if (zone === 'paving' && body.wood.fitsPile) acceptLogIntoWoodpile(body);
      else sendToCampfire(body);
    }
  }

  el('hud').classList.add('details');
  el('hud').hidden = false;
  el('held-saw').hidden = el('kit').hidden = el('side').hidden = el('depth').hidden = true;
  el('gap').hidden = false;
  Object.assign(el('back'), { href: './#stands', textContent: '← Стенды' });
  el('regrow').textContent = 'Сбросить стенд (R)';
  const help = el('help-body');
  const instructions = help.querySelectorAll('.desktop-only');
  instructions[0].textContent = 'WASD — ходить, мышь — осмотреться, C — присесть. Щелчок или E — поднять и бросить. На плитняке дрова сортируются. Прямо на углях сгорит любое полено.';
  instructions[1].textContent = 'B — подбросить ветку в костёр, P — добавить полено в поленницу. Esc — отпустить мышь.';
  const feed = document.createElement('button');
  feed.type = 'button';
  feed.id = 'wood-feed';
  feed.textContent = 'Подбросить ветку · B';
  el('utility').appendChild(feed);
  feed.addEventListener('click', quickFeedFire);

  const crosshair = document.createElement('div');
  Object.assign(crosshair.style, {
    position: 'absolute', left: '50%', top: '50%', width: '8px', height: '8px',
    marginLeft: '-4px', marginTop: '-4px', borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.85)', boxShadow: '0 0 0 1.5px rgba(24, 35, 31, 0.75)',
    pointerEvents: 'none', zIndex: '5',
  });
  el('hud').appendChild(crosshair);

  const player = makePlayer();
  player.pos.set(2.7, 0, 1.1);
  player.yaw = 0.19;
  player.pitch = -0.32;
  const keys = new Set(), stick = bindStick(el('stick')), actionBtn = el('touch-saw');
  actionBtn.textContent = 'Взять / Бросить';

  let held = null, heldYawOffset = 0, heldRollAngle = 0, aimed = null;
  const prevHeldPos = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(), centerNdc = new THREE.Vector2(0, 0);
  const holdTargetPos = new THREE.Vector3(), holdTargetQuat = new THREE.Quaternion(), viewDir = new THREE.Vector3();

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
      droppedItems.add(dropped);
      processDropZone();
      updateHudText();
      return;
    }
    const target = findAimedBody();
    if (!target) return;
    if (target.wood.tooHeavy) {
      sayNotice(target.wood.verdict || 'Бревно тяжёлое — распили на части!', 3500);
      updateHudText();
      return;
    }
    const idx = world.bodies.indexOf(target);
    if (idx !== -1) world.bodies.splice(idx, 1);
    droppedItems.delete(target);
    held = target;
    heldYawOffset = new THREE.Euler().setFromQuaternion(held.quaternion, 'YXZ').y - player.yaw;
    heldRollAngle = 0;
    prevHeldPos.copy(held.position);
    updateHudText();
  }

  function updateHudText() {
    const activeNotice = performance.now() < statusNotice.until ? statusNotice.text : '';
    if (held) {
      const zone = dropZoneAt(held.position);
      paving.mat.color.setHex(zone === 'paving' ? 0xc2d8b8 : 0xe8e2d4);
      if (zone === 'embers') {
        crosshair.style.background = '#ffac70';
        el('hint').textContent = 'Щелчок или E — бросить в угли';
        el('log').textContent = `${held.wood.title} сгорит целиком`;
      } else if (zone === 'paving') {
        crosshair.style.background = '#b8e8a8';
        el('hint').textContent = held.wood.fitsPile ? 'Щелчок или E — уложить в поленницу' : 'Щелчок или E — отправить в костёр';
        el('log').textContent = activeNotice || held.wood.verdict;
      } else {
        crosshair.style.background = '#9be89b';
        el('hint').textContent = `${held.wood.canDrag ? 'Тащишь по земле' : held.wood.canRoll ? 'Катишь' : 'Несёшь'} · ${held.wood.title}`;
        el('log').textContent = activeNotice || 'На плитняке дрова сортируются. Прямо на углях сгорит любое полено.';
      }
      return;
    }
    paving.mat.color.setHex(0xffffff);
    if (aimed) {
      crosshair.style.background = aimed.wood.tooHeavy ? '#ff6b6b' : '#ffd15c';
      el('hint').textContent = aimed.wood.tooHeavy
        ? `${aimed.wood.title} — Бревно тяжёлое, распили на части!`
        : `${aimed.wood.title} · ${aimed.wood.canDrag ? 'Тащить' : aimed.wood.canRoll ? 'Катить' : 'Взять'}`;
      el('log').textContent = activeNotice || aimed.wood.verdict;
    } else {
      crosshair.style.background = 'rgba(255, 255, 255, 0.85)';
      el('hint').textContent = '';
      el('log').textContent = activeNotice || 'Щелчок — поднять или бросить · C — присесть у углей';
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

  // Проба с места наблюдателя проходит тот же путь, что ветка, брошенная рукой.
  function quickFeedFire() {
    const start = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.8).add(camera.position);
    start.y = Math.max(0.45, start.y - 0.2);
    const body = createLogItem(world, scene, {
      length: 0.56 + rnd() * 0.21, radius: 0.028, twigs: 3, pos: start, yaw: player.yaw + 0.5,
    });
    sendToCampfire(body);
  }
  addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
    keys.add(e.code);
    if (e.code === 'KeyC' && !e.repeat) player.crouch = !player.crouch;
    if (e.code === 'KeyE' && !e.repeat) toggleHold();
    if (e.code === 'KeyP' && !e.repeat) quickSpawnLogToPile();
    if (e.code === 'KeyB' && !e.repeat) quickFeedFire();
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
    const speed = walkSpeed(player, keys) * haulSpeed(held?.wood);
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
      const lerpFactor = 1 - Math.exp(-18 * dt);
      if (held.wood.canDrag) {
        dragBranch(held, world, player.pos, forward, dt);
      } else if (held.wood.canRoll) {
        const r = Math.max(0.08, held.wood.radius || 0.14);
        holdTargetPos.copy(player.pos).addScaledVector(forward, 1.45);
        holdTargetPos.y = r;
        held.position.lerp(holdTargetPos, lerpFactor);
        const signedDist = held.position.clone().sub(prevHeldPos).dot(forward);
        heldRollAngle += signedDist / r;
        prevHeldPos.copy(held.position);
        const alignAcross = new THREE.Quaternion().setFromUnitVectors(held.wood.cutDir, right);
        const wheelSpin = new THREE.Quaternion().setFromAxisAngle(right, heldRollAngle);
        holdTargetQuat.copy(wheelSpin.multiply(alignAcross));
        held.quaternion.slerp(holdTargetQuat, lerpFactor);
        held.place();
      } else {
        camera.getWorldDirection(viewDir);
        holdTargetPos.copy(camera.position).addScaledVector(viewDir, held.wood.holdDist ?? 1.7);
        holdTargetPos.y += HOLD_DROP_LOW;
        const minHeight = Math.max(0.18, held.wood.radius + 0.08);
        if (holdTargetPos.y < minHeight) holdTargetPos.y = minHeight;

        held.position.lerp(holdTargetPos, lerpFactor);
        holdTargetQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw + heldYawOffset);
        held.quaternion.slerp(holdTargetQuat, lerpFactor);
        held.place();
      }
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

    // Древесина сначала обугливается, затем оседает и раскалывается на свежие угли.
    let lit = false;
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
        if (!b.coating) {
          b.coating = scorchLimb(b.limb, b.reach);
          campfire.ignite(b.local.x, b.local.y);
        }
        lit = true;
        b.coating.burn.value = p;
        const collapse = THREE.MathUtils.smoothstep(p, 0.47, 1);
        const scale = 1 - 0.22 * collapse;
        b.object.scale.setScalar(scale);
        b.object.position.y = b.toPos.y - collapse * 0.095;
        if (!b.deposited && p >= 0.82) {
          campfire.deposit(b.local.x, b.local.y, b.mass, b.yaw, b.length);
          b.deposited = true;
        }
        if (p >= 1) {
          removeFuel(b);
          sayNotice('Древесина прогорела. На месте излома осели свежие угли.', 2700);
          burningItems.splice(i, 1);
        }
      }
    }

    world.step(dt);
    processDropZone();
    campfire.tick(dt, elapsed, lit);
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
