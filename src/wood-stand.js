import * as THREE from 'three';
import { MOUSE, fieldOfView, makePlayer, forwardOf, turnHead, walkInput, walkSpeed, stepEyes, eyeCamera, bindStick } from './player.js';
import { Body, World } from './bodies.js';
import { dressBark } from './bark.js';
import { atlas } from './kit.js';
import { Smoke } from './smoke.js';
import { generator } from './random.js';

// Стенд «Костёр и поленница» (Шаг 1):
// Поленница слева, единая зона приёмки посередине, горящий костёр с дымом справа.
// Переноска без рук в кадре («как в старых играх»): взятый предмет плавно парит в воздухе перед игроком.
const HOLD_DIST = 1.55, HOLD_DROP_LOW = -0.32, PICK_RANGE = 3.0;
const ZONE_POS = new THREE.Vector3(0, 0, -1.6), ZONE_HALF = { x: 0.75, z: 0.65 };
const PILE_POS = new THREE.Vector3(-1.85, 0, -1.6), FIRE_POS = new THREE.Vector3(1.85, 0, -1.6);

const barkMat = dressBark();
const cutMat = new THREE.MeshLambertMaterial({ color: 0xd8c196 });
const twigMat = new THREE.MeshLambertMaterial({ color: 0x6b634b });
const boardMat = new THREE.MeshLambertMaterial({ map: atlas('wall'), color: 0x9c8870 });

function rodInertia(m, r, L) {
  const ix = Math.max(0.01, 0.5 * m * r * r), iyz = Math.max(0.01, (m * (3 * r * r + L * L)) / 12);
  return new THREE.Matrix3().set(ix, 0, 0, 0, iyz, 0, 0, 0, iyz);
}

// Собирает 3D-модель и физическое тело (Body) бревна или ветки вдоль локальной оси X.
function createWoodItem(world, scene, { kind, length, radius, twigs = 0, branches = 0, pos, yaw = 0 }) {
  const group = new THREE.Group();
  const cylGeo = new THREE.CylinderGeometry(radius * 0.94, radius, length, 14, 1, false);
  cylGeo.rotateZ(-Math.PI / 2);
  const trunkMesh = new THREE.Mesh(cylGeo, [barkMat, cutMat, cutMat]);
  trunkMesh.castShadow = trunkMesh.receiveShadow = true;
  group.add(trunkMesh);

  const twigGroup = new THREE.Group();
  for (let i = 0; i < twigs; i++) {
    const tLen = 0.16 + (i % 2) * 0.06;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.016, tLen, 6), twigMat);
    const x = (i / Math.max(1, twigs - 1) - 0.5) * (length * 0.65), a = i * 2.2 + 0.5;
    mesh.position.set(x, Math.cos(a) * (radius + tLen * 0.38), Math.sin(a) * (radius + tLen * 0.38));
    mesh.rotation.set(Math.sin(a) * 0.9, 0, (i % 2 ? 1 : -1) * 0.55);
    twigGroup.add(mesh);
  }
  if (twigs > 0) group.add(twigGroup);

  for (let i = 0; i < branches; i++) {
    const bLen = length * (0.45 + 0.1 * (i % 2)), bRad = radius * 0.65;
    const bGeo = new THREE.CylinderGeometry(bRad * 0.6, bRad, bLen, 8);
    bGeo.translate(0, bLen * 0.45, 0);
    const mesh = new THREE.Mesh(bGeo, twigMat);
    mesh.position.set(-length * 0.15 + i * (length * 0.32), 0, 0);
    mesh.rotation.set((i % 2 === 0 ? 1 : -1) * 0.65, 0, -0.85);
    group.add(mesh);
  }
  scene.add(group);

  const half = Math.max(0.02, length / 2 - radius);
  const mass = Math.max(1.2, Math.PI * radius * radius * length * 650);
  const body = new Body(group, {
    mass,
    inertia: rodInertia(mass, radius, length),
    position: pos.clone(),
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    capsules: [{ a: new THREE.Vector3(-half, 0, 0), b: new THREE.Vector3(half, 0, 0), r: radius }],
  });

  const cm = Math.round(length * 100), fitsPile = kind === 'log' && cm >= 50 && cm <= 100;
  body.wood = {
    kind, length, cm, radius, twigs, twigGroup, fitsPile,
    title: kind === 'branch' ? `Свежая ветка (${cm} см)` : twigs > 0 ? `Бревно с веточками (${cm} см)` : `Бревно (${cm} см)`,
    verdict: fitsPile
      ? (twigs > 0 ? 'В поленницу (50–100 см) · веточки в костёр' : 'Подходит в поленницу (50–100 см)')
      : kind === 'branch' ? 'Ветка → в костёр (горит с дымом)' : cm < 50 ? `Короче 50 см (${cm} см) → в костёр` : `Длиннее 100 см (${cm} см) → в костёр`,
  };
  world.add(body);
  return body;
}

// Каркас поленницы из досок, открытый спереди (+Z), чтобы поленья ложились срезом к нам.
function buildWoodpileFrame() {
  const group = new THREE.Group(), W = 1.24, D = 1.0, H = 1.15, T = 0.04;
  const box = (w, h, d, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boardMat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  box(W, 0.06, 0.08, 0, 0.03, -D * 0.38);
  box(W, 0.06, 0.08, 0, 0.03, D * 0.38);
  for (let i = -2; i <= 2; i++) box(W - 0.04, T, 0.16, 0, 0.06 + T / 2, i * 0.19);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(0.07, H, 0.07, sx * (W / 2 - 0.035), H / 2, sz * (D / 2 - 0.035));
    for (let h = 0.22; h <= H - 0.1; h += 0.22) box(T, 0.14, D - 0.04, sx * (W / 2 - T / 2), h, 0);
  }
  box(W, 0.12, T, 0, 0.35, -D / 2 + T / 2);
  box(W, 0.12, T, 0, 0.8, -D / 2 + T / 2);
  for (let i = -2; i <= 2; i++) box(W + 0.14, T, 0.21, 0, H + 0.04 - i * 0.015, i * 0.21, 0.07);
  group.position.copy(PILE_POS);
  return group;
}

// Единая приёмная зона между поленницей и костром.
function buildDropZone() {
  const group = new THREE.Group(), W = ZONE_HALF.x * 2, D = ZONE_HALF.z * 2;
  const padMat = new THREE.MeshLambertMaterial({ color: 0x5d7052, transparent: true, opacity: 0.45 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(W - 0.08, 0.015, D - 0.08), padMat);
  pad.position.y = 0.008;
  group.add(pad);
  const borderMat = new THREE.MeshLambertMaterial({ map: atlas('wall'), color: 0xc2a878 });
  const bar = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), borderMat);
    m.position.set(x, 0.018, z);
    group.add(m);
  };
  bar(W, 0.05, 0, -D / 2 + 0.025);
  bar(W, 0.05, 0, D / 2 - 0.025);
  bar(0.05, D - 0.1, -W / 2 + 0.025, 0);
  bar(0.05, D - 0.1, W / 2 - 0.025, 0);
  group.position.copy(ZONE_POS);
  return { group, padMat };
}

// Рабочий костёр: камни по кругу, горящие поленья, языки пламени, свет и дым из src/smoke.js.
function buildCampfire(rnd) {
  const group = new THREE.Group();
  const coal = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.54, 0.05, 14), new THREE.MeshBasicMaterial({ color: 0x3b1708 }));
  coal.position.y = 0.025;
  group.add(coal);

  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x626661 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11 + (i % 3) * 0.02, 0), stoneMat);
    stone.position.set(Math.cos(a) * 0.56, 0.06, Math.sin(a) * 0.56);
    stone.scale.set(1.2, 0.75, 1.0);
    stone.rotation.y = a;
    group.add(stone);
  }

  const charMat = new THREE.MeshLambertMaterial({ color: 0x3a281c, emissive: 0x551a05 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.2;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.62, 8), charMat);
    log.position.set(Math.cos(a) * 0.16, 0.15, Math.sin(a) * 0.16);
    log.rotation.set(-Math.sin(a) * 0.85, 0, Math.cos(a) * 0.85);
    group.add(log);
  }

  const flames = [], flameColors = [0xff6a1a, 0xffa62b, 0xffd15c];
  for (let i = 0; i < 7; i++) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.08 + (i % 3) * 0.03, 0.34 + (i % 2) * 0.12, 6),
      new THREE.MeshBasicMaterial({ color: flameColors[i % flameColors.length] }),
    );
    const a = (i / 7) * Math.PI * 2, r = i === 0 ? 0 : 0.13;
    cone.position.set(Math.cos(a) * r, 0.22, Math.sin(a) * r);
    group.add(cone);
    flames.push({ cone, baseH: cone.position.y, phase: i * 1.3 });
  }

  const light = new THREE.PointLight(0xff7b29, 2.2, 7.5);
  light.position.set(0, 0.55, 0);
  group.add(light);
  group.position.copy(FIRE_POS);

  const smoke = new Smoke(new THREE.Vector3(FIRE_POS.x, 0.52, FIRE_POS.z), rnd);
  function tick(dt, time) {
    smoke.tick(dt);
    light.intensity = 2.0 + 0.35 * Math.sin(time * 9.5) + 0.2 * Math.cos(time * 15.3);
    for (const f of flames) {
      const s = 0.85 + 0.25 * Math.sin(time * 11 + f.phase);
      f.cone.scale.set(1 + 0.12 * Math.cos(time * 8 + f.phase), s, 1 + 0.12 * Math.sin(time * 9 + f.phase));
      f.cone.position.y = f.baseH + (s - 1) * 0.08;
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

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshLambertMaterial({ color: 0x7e8c69 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(40, 40, 0x5c6b50, 0x6f7e60);
  grid.position.y = 0.002;
  scene.add(floor, grid);

  const rnd = generator(42);
  const woodpile = buildWoodpileFrame(), dropZone = buildDropZone(), campfire = buildCampfire(rnd);
  scene.add(woodpile, dropZone.group, campfire.group, campfire.smoke);

  const worldRoot = new THREE.Group();
  scene.add(worldRoot);
  const world = new World(worldRoot, () => 0, (_, n) => n.set(0, 1, 0));

  const items = [];
  function spawnSampleItems() {
    while (items.length) scene.remove(items.pop().object);
    world.bodies.length = 0;
    const specs = [
      { kind: 'log', length: 0.60, radius: 0.085, twigs: 0, pos: new THREE.Vector3(-1.4, 0.12, 0.7), yaw: 0.15 },
      { kind: 'log', length: 0.75, radius: 0.095, twigs: 4, pos: new THREE.Vector3(-0.45, 0.14, 0.85), yaw: -0.25 },
      { kind: 'log', length: 0.92, radius: 0.10,  twigs: 2, pos: new THREE.Vector3(0.55, 0.12, 0.75), yaw: 0.1 },
      { kind: 'log', length: 0.34, radius: 0.085, twigs: 0, pos: new THREE.Vector3(-1.05, 0.11, 1.65), yaw: 0.6 },
      { kind: 'log', length: 1.25, radius: 0.09,  twigs: 0, pos: new THREE.Vector3(1.45, 0.11, 1.35), yaw: -0.4 },
      { kind: 'branch', length: 0.80, radius: 0.035, twigs: 3, branches: 2, pos: new THREE.Vector3(0.15, 0.12, 1.7), yaw: 0.3 },
      { kind: 'branch', length: 0.65, radius: 0.03,  twigs: 2, branches: 2, pos: new THREE.Vector3(1.15, 0.12, 2.0), yaw: -0.7 },
    ];
    for (const s of specs) items.push(createWoodItem(world, scene, s));
  }
  spawnSampleItems();

  el('hud').hidden = false;
  el('held-saw').hidden = el('kit').hidden = el('side').hidden = el('depth').hidden = true;
  el('gap').hidden = false;
  el('gap').textContent = 'Поленница · Зона приёмки · Костёр';
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
  player.pos.set(0, 0, 3.2);
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
    if (held) {
      const overZone = isInDropZone(held.position);
      dropZone.padMat.color.setHex(overZone ? (held.wood.fitsPile ? 0x7cb342 : 0xe58e26) : 0x5d7052);
      dropZone.padMat.opacity = overZone ? 0.72 : 0.45;
      crosshair.style.background = overZone ? '#ffd15c' : '#9be89b';
      el('hint').textContent = overZone ? `Над зоной приёмки: ${held.wood.title}` : `Несёшь: ${held.wood.title} (ЛКМ — положить)`;
      el('log').textContent = overZone ? `Зона приёмки → ${held.wood.verdict}` : `${held.wood.verdict} · Неси в зону между поленницей и костром`;
      return;
    }
    dropZone.padMat.color.setHex(0x5d7052);
    dropZone.padMat.opacity = 0.45;
    if (aimed) {
      crosshair.style.background = '#ffd15c';
      el('hint').textContent = `${aimed.wood.title} — ЛКМ: взять`;
      el('log').textContent = aimed.wood.verdict;
    } else {
      crosshair.style.background = 'rgba(255, 255, 255, 0.85)';
      el('hint').textContent = '';
      const inZone = items.filter((b) => isInDropZone(b.position));
      if (inZone.length > 0) {
        const last = inZone[inZone.length - 1];
        el('log').textContent = `В зоне приёмки (${inZone.length} шт.): ${last.wood.title} — ${last.wood.verdict}`;
      } else {
        el('log').textContent = 'Наведи точку на бревно или ветку и нажми ЛКМ, чтобы понести перед собой';
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

  addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
    keys.add(e.code);
    if (e.code === 'KeyC' && !e.repeat) player.crouch = !player.crouch;
    if (e.code === 'KeyE' && !e.repeat) toggleHold();
    if (e.code === 'KeyR' && !e.repeat) { held = null; spawnSampleItems(); }
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
    player.pos.clampScalar(-25, 25);
    stepEyes(player, right, Math.hypot(input.side, input.ahead) * speed, dt);
    eyeCamera(camera, player);

    if (held) {
      camera.getWorldDirection(viewDir);
      holdTargetPos.copy(camera.position).addScaledVector(viewDir, HOLD_DIST);
      holdTargetPos.y += HOLD_DROP_LOW;
      const minHeight = held.wood.radius + 0.08;
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

    world.step(dt);
    campfire.tick(dt, elapsed);
    updateHudText();
    renderer.render(scene, camera);
  }

  new ResizeObserver(() => {
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }).observe(canvas);

  renderer.setAnimationLoop(frame);
}
