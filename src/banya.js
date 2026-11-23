import * as THREE from 'three';
import { planHouse, buildHouse, R, COURSE, PLINTH } from './house.js';
import { PANE, LINING } from './window.js';
import { buildDoor } from './porch.js';
import { Planks, boardMaterials, TONES } from './attic.js';
import { buildPier } from './pier.js';
import { height } from './terrain.js';
import { generator } from './random.js';
import { gasPostMaterial } from './gas.js';
import { powerWireMaterial } from './power.js';
import { curve, sag, tube } from './pipe.js';

const W = 4, D = 4, POLE_HEIGHT = 2, SPAN = 4;
const UP = new THREE.Vector3(0, 1, 0);
// Сруб параллелен касательной к нашему берегу; его площадка не выравнивает сам берег.
export function planBanya(seed, river, side) {
  const x = side * 10, angle = -Math.atan(river.slope(x));
  const z = river.brow(x) + D / 2 + 0.65;
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
  const window = (wall, at) => ({ kind: 'window', wall, at, width: PANE[0] * 0.64, bottom: 0.85, top: 0.85 + PANE[1] * 0.62 });
  const plan = { ...template, w: W, d: D, middle: null, courses: 11, knee: 0, pitch: 0.72,
    openings: [door, window('left', 0), window('right', 0)], parts: new Set(['roof', 'chimney']),
    carving: null, attic: null, roof: 'tes', plinth: 'brick', tambour: false, noPorch: true,
    plainWindows: true, curtains: false, sashColor: 0x241912, windowBacking: 0x30231c, backingMargin: COURSE + LINING + 0.02,
    plinthHeight: PLINTH + 0.06, plinthOut: 0.025, plinthCap: true, noDrip: true };
  const group = buildHouse(plan);
  group.position.set(x, base, z);
  group.rotation.y = angle;
  const localToWorld = (lx, lz) => new THREE.Vector2(x + Math.cos(angle) * lx + Math.sin(angle) * lz,
    z - Math.sin(angle) * lx + Math.cos(angle) * lz);
  const worldToLocal = (px, pz) => {
    const dx = px - x, dz = pz - z;
    return { x: Math.cos(angle) * dx - Math.sin(angle) * dz, z: Math.sin(angle) * dx + Math.cos(angle) * dz };
  };

  // Дверь и крыша настила используют те же детали, что изба и мостки.
  const boards = new Planks(boardMaterials(TONES.gable));
  const roof = new Planks(boardMaterials(TONES.roof));
  const front = -D / 2 - R, top = PLINTH + door.bottom;
  const houseDoor = buildDoor(seed + 211, door, { along: 'x', at: -D / 2 }, { base: PLINTH, face: R });
  const start = localToWorld(0, front), along = new THREE.Vector2(-Math.sin(angle), -Math.cos(angle));
  const across = new THREE.Vector2(Math.cos(angle), -Math.sin(angle));
  const shore = river.shore(start.x);
  const length = Math.max(2.5, (start.y - shore) / Math.cos(angle) + 0.8);
  const deckTop = base + top;
  const deckPlan = { seed: seed + 211, start, along, across, top: deckTop, length, land: 0, width: W };
  const dock = buildPier(deckPlan);
  // Односкатный навес закрывает настил целиком, с заметным уклоном от сруба к реке.
  const roofHeight = top + 2.9, fall = 0.24;
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
  const railingMaterials = boardMaterials(TONES.gable);
  const railPosts = new Planks(railingMaterials, 0.1);
  const rails = new Planks(railingMaterials, 0.06);
  const balusters = new Planks(railingMaterials, 0.035);
  addDockRails({ railPosts, rails, balusters, top, front, length, stairZ, stairWidth, stairRun, footY, rnd });
  const railing = new THREE.Group();
  railing.name = 'banya-dock-rails';
  railing.add(...railPosts.meshes(), ...rails.meshes(), ...balusters.meshes());
  houseDoor.name = 'banya-door';
  group.add(...boards.meshes(), ...roof.meshes(), ...supports.meshes(), railing, houseDoor);
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

function addDockRails({ railPosts, rails, balusters, top, front, length, stairZ, stairWidth, stairRun, footY, rnd }) {
  const W2 = W / 2, up = UP, sideAxis = new THREE.Vector3(0, 0, -1);
  const addVertical = (mesh, x, z, y0, y1, axis, normal, width) => mesh.add(
    [[-width / 2, y0], [width / 2, y0], [width / 2, y1], [-width / 2, y1]],
    { o: new THREE.Vector3(x, 0, z), X: axis, Y: up }, normal, [0, 1], width, rnd);
  const sideRail = (mesh, x, d0, d1, y0, y1, normal) => mesh.add(
    [[d0, y0], [d1, y0], [d1, y1], [d0, y1]],
    { o: new THREE.Vector3(x, 0, front), X: sideAxis, Y: up }, normal, [1, 0], y1 - y0, rnd);
  const railLo = top + 0.22, railHi = top + 0.9;
  const gap = [0.8 - stairWidth / 2 - 0.08, 0.8 + stairWidth / 2 + 0.08];
  for (const sign of [-1, 1]) {
    const normal = new THREE.Vector3(sign, 0, 0), x = sign * W2;
    const spans = sign < 0 ? [[0, length]] : [[0, gap[0]], [gap[1], length]];
    for (const [d0, d1] of spans) {
      sideRail(rails, x, d0, d1, railLo, railLo + 0.06, normal);
      sideRail(rails, x, d0, d1, railHi - 0.06, railHi, normal);
      const first = Math.ceil((d0 + 0.12) / 0.8) * 0.8;
      for (let d = first; d < d1 - 0.12; d += 0.8) {
        addVertical(balusters, x, front - d, railLo + 0.06, railHi - 0.06,
          new THREE.Vector3(0, 0, 1), normal, 0.04);
      }
    }
    const postDs = sign < 0 ? [0, ...Array.from({ length: Math.floor(length) }, (_, i) => i + 1), length]
      : [0, gap[0], gap[1], ...Array.from({ length: Math.floor(length) }, (_, i) => i + 1).filter((d) => d < gap[0] || d > gap[1]), length];
    for (const d of new Set(postDs.filter((v) => v <= length))) {
      if (sign > 0 && d > gap[0] && d < gap[1]) continue;
      addVertical(railPosts, x, front - d, top, railHi + 0.05, new THREE.Vector3(0, 0, 1), normal, 0.1);
    }
  }
  const endZ = front - length, endNormal = new THREE.Vector3(0, 0, -1), endAxis = new THREE.Vector3(1, 0, 0);
  for (const [y0, y1] of [[railLo, railLo + 0.06], [railHi - 0.06, railHi]]) {
    rails.add([[-W2, y0], [W2, y0], [W2, y1], [-W2, y1]],
      { o: new THREE.Vector3(0, 0, endZ), X: endAxis, Y: up }, endNormal, [1, 0], y1 - y0, rnd);
  }
  for (let x = -W2; x <= W2 + 0.01; x += 0.8) {
    addVertical(railPosts, x, endZ, top, railHi + 0.05, endAxis, endNormal, 0.1);
    if (x < W2 - 0.1) addVertical(balusters, x + 0.4, endZ, railLo + 0.06, railHi - 0.06, endAxis, endNormal, 0.04);
  }
  const stairAxis = new THREE.Vector3(1, 0, 0);
  const floorAt = (t) => top + (footY - top) * t;
  for (const sign of [-1, 1]) {
    const z = stairZ + sign * (stairWidth / 2 + 0.08), normal = new THREE.Vector3(0, 0, sign);
    const frame = { o: new THREE.Vector3(W2, 0, z), X: stairAxis, Y: up };
    for (const offset of [0.22, 0.9]) {
      rails.add([[0, floorAt(0) + offset], [stairRun, floorAt(1) + offset],
        [stairRun, floorAt(1) + offset + 0.06], [0, floorAt(0) + offset + 0.06]],
      frame, normal, [1, 0], stairRun, rnd);
    }
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, x = W2 + t * stairRun, zPost = z;
      addVertical(railPosts, x, zPost, floorAt(t), floorAt(t) + 0.95, stairAxis, normal, 0.1);
    }
    for (let x = 0.25; x < stairRun - 0.1; x += 0.25) {
      const t = x / stairRun;
      addVertical(balusters, W2 + x, z, floorAt(t) + 0.28, floorAt(t) + 0.84, stairAxis, normal, 0.04);
    }
  }
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
