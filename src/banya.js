import * as THREE from 'three';
import { planHouse, buildHouse, R, COURSE, PLINTH } from './house.js';
import { PANE, LINING } from './window.js';
import { Planks, boardMaterials, TONES } from './attic.js';
import { buildPier } from './pier.js';
import { groundPatch, height } from './terrain.js';
import { generator } from './random.js';
import { tiles, soften } from './surface.js';
import { gasPostMaterial } from './gas.js';
import { powerWireMaterial } from './power.js';
import { curve, sag, tube } from './pipe.js';

const W = 4, D = 4, POLE_HEIGHT = 2, SPAN = 4;
const UP = new THREE.Vector3(0, 1, 0);
const earth = soften(new THREE.MeshLambertMaterial({ map: tiles(['assets/textures/road-base.jpg'])[0] }),
  { contrast: 0.9, saturation: 0.8, scales: [0.13, 0.5], low: [0.92, 0.92, 0.9], high: [1.02, 1.02, 1], cells: [4, 2] });

// Сруб параллелен касательной к нашему берегу; его площадка не выравнивает сам берег.
export function planBanya(seed, river, side) {
  const x = side * 10, angle = -Math.atan(river.slope(x));
  const z = river.brow(x) + D / 2 + 2.7;
  const c = Math.cos(angle), s = Math.sin(angle);
  const extent = Math.abs(c) * (W / 2 + 0.35) + Math.abs(s) * (D / 2 + 0.35);
  const depth = Math.abs(s) * (W / 2 + 0.35) + Math.abs(c) * (D / 2 + 0.35);
  return { seed, x, z, angle, pad: { x, z, w: 2 * extent, d: 2 * depth } };
}

export function buildBanya(site, river, power, house) {
  const { seed, x, z, angle } = site, rnd = generator(seed + 211);
  const base = height(x, z);
  const template = planHouse(seed + 211);
  const bottom = R + 1.08 * R + LINING - COURSE / 2;
  const door = { kind: 'door', wall: 'back', at: 0, width: 0.9, bottom, top: 2.0 };
  const window = (wall, at) => ({ kind: 'window', wall, at, width: PANE[0], bottom: 0.85, top: 0.85 + PANE[1] });
  const plan = { ...template, w: W, d: D, middle: null, courses: 11, knee: 0, pitch: 0.62,
    openings: [door, window('left', 0), window('right', 0)], parts: new Set(['roof', 'chimney']),
    carving: null, attic: null, roof: 'tes', plinth: 'boards', tambour: false, noPorch: true, plainWindows: true, noDrip: true };
  const group = buildHouse(plan);
  group.position.set(x, base, z);
  group.rotation.y = angle;
  const localToWorld = (lx, lz) => new THREE.Vector2(x + Math.cos(angle) * lx + Math.sin(angle) * lz,
    z - Math.sin(angle) * lx + Math.cos(angle) * lz);
  const worldToLocal = (px, pz) => {
    const dx = px - x, dz = pz - z;
    return { x: Math.cos(angle) * dx - Math.sin(angle) * dz, z: Math.sin(angle) * dx + Math.cos(angle) * dz };
  };

  // Дощатая дверь и крыша настила используют те же доски, что изба и мостки.
  const boards = new Planks(boardMaterials(TONES.gable));
  const roof = new Planks(boardMaterials(TONES.roof));
  const front = -D / 2 - R, top = PLINTH + door.bottom;
  const frontFrame = { o: new THREE.Vector3(0, 0, front + 0.06), X: new THREE.Vector3(1, 0, 0), Y: UP };
  for (let a = -door.width / 2; a < door.width / 2 - 0.01; a += 0.1) {
    boards.add([[a, top], [Math.min(a + 0.098, door.width / 2), top], [Math.min(a + 0.098, door.width / 2), PLINTH + door.top], [a, PLINTH + door.top]],
      frontFrame, new THREE.Vector3(0, 0, -1), [0, 1], 0.1, rnd);
  }
  const start = localToWorld(0, front), along = new THREE.Vector2(-Math.sin(angle), -Math.cos(angle));
  const across = new THREE.Vector2(Math.cos(angle), -Math.sin(angle));
  const shore = river.shore(start.x);
  const length = Math.max(2.5, (start.y - shore) / Math.cos(angle) + 0.8);
  const deckTop = base + top;
  const deckPlan = { seed: seed + 211, start, along, across, top: deckTop, length, land: 0, width: W };
  const dock = buildPier(deckPlan);
  // Односкатный навес закрывает настил целиком; опоры только по углам, без перил.
  const roofHeight = top + 2.45, fall = 0.12;
  const roofOrigin = new THREE.Vector3(0, roofHeight, front + 0.1);
  const roofY = new THREE.Vector3(0, -fall, -1).normalize();
  const roofNormal = new THREE.Vector3(0, 1, -fall).normalize();
  const roofLength = (length + 0.35) * Math.sqrt(1 + fall * fall);
  for (let a = -W / 2 - 0.2; a < W / 2 + 0.2; a += 0.14) {
    roof.add([[a, 0], [Math.min(a + 0.145, W / 2 + 0.2), 0], [Math.min(a + 0.145, W / 2 + 0.2), roofLength], [a, roofLength]],
      { o: roofOrigin, X: new THREE.Vector3(1, 0, 0), Y: roofY }, roofNormal, [0, 1], 0.14, rnd);
  }
  const supports = new Planks(boardMaterials(TONES.gable), 0.12);
  for (const a of [-W / 2 + 0.12, W / 2 - 0.12]) {
    const h = roofHeight - fall * (length - 0.15);
    supports.add([[a - 0.06, top], [a + 0.06, top], [a + 0.06, h], [a - 0.06, h]],
      { o: new THREE.Vector3(0, 0, front - length + 0.15), X: new THREE.Vector3(1, 0, 0), Y: UP },
      new THREE.Vector3(0, 0, -1), [0, 1], 0.12, rnd);
  }
  // Вход на настил сбоку по ступеням, лежащим над берегом.
  const stairZ = front - 0.8, stairWidth = 1.1, stairRun = 1.2, steps = 6;
  const foot = localToWorld(W / 2 + stairRun, stairZ);
  const footY = height(foot.x, foot.y) - base;
  for (let i = 0; i < steps; i++) {
    const a = W / 2 + i * stairRun / steps, b = W / 2 + (i + 1) * stairRun / steps;
    const y = top + (footY - top) * ((i + 1) / steps);
    boards.add([[a, stairZ - stairWidth / 2], [b, stairZ - stairWidth / 2], [b, stairZ + stairWidth / 2], [a, stairZ + stairWidth / 2]],
      { o: new THREE.Vector3(0, y - 0.022, 0), X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 0, 1) }, UP, [0, 1], 0.2, rnd);
  }
  group.add(...boards.meshes(), ...roof.meshes(), ...supports.meshes());
  const deck = (px, pz) => {
    const p = worldToLocal(px, pz), distance = front - p.z;
    if (Math.abs(p.x) <= W / 2 && distance >= 0 && distance <= length) return deckTop;
    if (p.x >= W / 2 && p.x <= W / 2 + stairRun && Math.abs(p.z - stairZ) <= stairWidth / 2) {
      const step = Math.min(steps, Math.floor((p.x - W / 2) / stairRun * steps) + 1);
      return base + top + (footY - top) * step / steps;
    }
    return -Infinity;
  };
  const blocks = (px, pz) => {
    const p = worldToLocal(px, pz);
    return Math.abs(p.x) < W / 2 + R + 0.25 && Math.abs(p.z) < D / 2 + R + 0.25;
  };
  const powerLine = buildBanyaPower(base, power, house, localToWorld);
  return { group, dock, powerLine, deck, blocks, plan, deckPlan };
}

// Берег внутри боковых заборов соединяет баню с двором без дополнительной вертикальной травы.
// Вызывать после makeMeadow, когда общая сетка рельефа уже построена.
export function buildBanyaGround(river, yard) {
  const geometry = groundPatch((x, z) => Math.abs(x) <= yard.w / 2 && z <= -yard.d / 2 && z >= river.shore(x) - 0.5);
  const pos = geometry.attributes.position, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = THREE.MathUtils.clamp(pos.getX(i), -yard.w / 2, yard.w / 2);
    const z = Math.min(pos.getZ(i), -yard.d / 2);
    if (x !== pos.getX(i) || z !== pos.getZ(i)) pos.setXYZ(i, x, height(x, z), z);
    uv[2 * i] = x / 4;
    uv[2 * i + 1] = -z / 4;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, earth);
  ground.receiveShadow = true;
  return ground;
}

function buildBanyaPower(base, power, house, localToWorld) {
  const source = power.house.anchor.clone().add(new THREE.Vector3(power.house.out * 0.2, 0, 0));
  const side = power.house.out, corner = localToWorld(side * (W / 2 + 0.4), D / 2 + 0.4);
  const end = localToWorld(side * (W / 2 + R), D / 2 - 0.5);
  const rear = new THREE.Vector3(source.x, source.y, house.at.z - house.plan.d / 2 - 0.7);
  const anchors = [rear, new THREE.Vector3(THREE.MathUtils.clamp(source.x, -19.3, 19.3), 0, rear.z - 0.7),
    new THREE.Vector3(corner.x, 0, corner.y)];
  const posts = [];
  for (let segment = 1; segment < anchors.length; segment++) {
    const a = anchors[segment - 1], b = anchors[segment], distance = Math.hypot(b.x - a.x, b.z - a.z);
    const count = Math.ceil(distance / SPAN);
    for (let i = 1; i <= count; i++) {
      const t = i / count, x = THREE.MathUtils.lerp(a.x, b.x, t), z = THREE.MathUtils.lerp(a.z, b.z, t);
      posts.push(new THREE.Vector3(x, height(x, z), z));
    }
  }
  const group = new THREE.Group();
  const tips = posts.map((p) => p.clone().addScaledVector(UP, POLE_HEIGHT));
  for (const p of posts) {
    const mesh = new THREE.Mesh(tube(curve([p, p.clone().addScaledVector(UP, POLE_HEIGHT)]), 0.03, { tile: 0.76, sides: 12 }), gasPostMaterial);
    mesh.castShadow = true;
    group.add(mesh);
  }
  const points = [source, rear, ...tips, new THREE.Vector3(end.x, base + 2, end.y)];
  for (let i = 1; i < points.length; i++) {
    const mesh = new THREE.Mesh(tube(sag(points[i - 1], points[i], 0.03), 0.008, { sides: 6 }), powerWireMaterial);
    group.add(mesh);
  }
  return group;
}
