import * as THREE from 'three';
import { planHouse, buildHouse, R, COURSE, PLINTH, LOG_MATERIAL } from './house.js';
import { PANE, LINING } from './window.js';
import { buildDoor, buildRailSegments } from './porch.js';
import { Planks, boardMaterials, TONES, buildRoofExtension } from './attic.js';
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

  // Дверь и настил используют те же доски, что изба и мостки.
  const boards = new Planks(boardMaterials(TONES.gable));
  const front = -D / 2 - R, top = PLINTH + door.bottom;
  const houseDoor = buildDoor(seed + 211, door, { along: 'x', at: -D / 2 }, { base: PLINTH, face: R });
  const start = localToWorld(0, front), along = new THREE.Vector2(-Math.sin(angle), -Math.cos(angle));
  const across = new THREE.Vector2(Math.cos(angle), -Math.sin(angle));
  const shore = river.shore(start.x);
  const length = Math.max(2.5, (start.y - shore) / Math.cos(angle) + 0.8);
  const deckTop = base + top;
  const deckPlan = { seed: seed + 211, start, along, across, top: deckTop, length, land: 0, width: W };
  const dock = buildPier(deckPlan);
  const roofShape = group.userData.roofShape;
  const roofEndZ = front - length - 0.35, roofStartZ = -roofShape.zEnd;
  const roofExtension = buildRoofExtension(plan, roofShape, roofEndZ);
  const rafters = buildBanyaRafters(roofShape, roofStartZ, roofEndZ, rnd);
  // Бревенчатые стойки и продольные балки поддерживают продолжение скатов над верандой.
  const supportZ = front - length + 0.05, eaveY = roofShape.ridge - (W / 2) * Math.tan(roofShape.pitch) - 0.12;
  const roofSupports = buildRoofSupports(supportZ, roofStartZ, W / 2, top, eaveY);
  // Лестница повторяет конструкцию крыльца: отдельные проступи, подступёнки и боковые тетивы.
  const stairZ = front - 0.8, stairWidth = 1.1, stairRun = 1.2;
  const foot = localToWorld(W / 2 + stairRun, stairZ);
  const footY = height(foot.x, foot.y) - base;
  const stairs = new Planks(boardMaterials(TONES.gable), 0.035);
  const treads = Math.max(2, Math.ceil((top - footY) / 0.17)), rise = (top - footY) / treads;
  const z0 = stairZ - stairWidth / 2, z1 = stairZ + stairWidth / 2;
  const stairFrame = { o: new THREE.Vector3(0, 0, 0), X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 0, 1) };
  for (let i = 0; i < treads; i++) {
    const a = W / 2 + i * stairRun / treads, b = W / 2 + (i + 1) * stairRun / treads;
    const treadY = top - (i + 1) * rise;
    stairs.add([[a, z0], [b, z0], [b, z1], [a, z1]],
      { ...stairFrame, o: new THREE.Vector3(0, treadY - 0.035, 0) }, UP, [1, 0], stairRun / treads, rnd);
    const upperY = top - i * rise;
    stairs.add([[z0, treadY], [z1, treadY], [z1, upperY], [z0, upperY]],
      { o: new THREE.Vector3(a, 0, 0), X: new THREE.Vector3(0, 0, 1), Y: UP },
      new THREE.Vector3(1, 0, 0), [1, 0], stairWidth, rnd);
  }
  const stringers = new Planks(boardMaterials(TONES.gable), 0.055);
  for (const sign of [-1, 1]) {
    const z = stairZ + sign * (stairWidth / 2 - 0.025);
    stringers.add([[W / 2 - 0.04, top - 0.08], [W / 2 + stairRun + 0.04, footY - 0.08],
      [W / 2 + stairRun + 0.04, footY - 0.2], [W / 2 - 0.04, top - 0.2]],
    { o: new THREE.Vector3(0, 0, z), X: new THREE.Vector3(1, 0, 0), Y: UP },
    new THREE.Vector3(0, 0, sign), [1, 0], stairRun, rnd);
  }
  const stairEnd = front - length;
  const railSegments = [];
  const rail = (x0, d0, x1, d1, normal, postStep = 0.8) => {
    const segmentLength = Math.hypot(x1 - x0, d1 - d0), postAt = [0];
    for (let d = postStep; d < segmentLength - 0.12; d += postStep) postAt.push(d);
    postAt.push(segmentLength);
    railSegments.push({
      from: new THREE.Vector3(x0, top, front - d0), to: new THREE.Vector3(x1, top, front - d1),
      normal, postAt,
    });
  };
  rail(-W / 2, 0, -W / 2, length, new THREE.Vector3(-1, 0, 0));
  const stairD0 = 0.8 - stairWidth / 2, stairD1 = 0.8 + stairWidth / 2;
  rail(W / 2, 0, W / 2, stairD0, new THREE.Vector3(1, 0, 0));
  rail(W / 2, stairD1, W / 2, length, new THREE.Vector3(1, 0, 0));
  rail(-W / 2, length, W / 2, length, new THREE.Vector3(0, 0, -1));
  for (const sign of [-1, 1]) {
    const z = stairZ + sign * (stairWidth / 2 - 0.025);
    const from = new THREE.Vector3(W / 2, top, z), to = new THREE.Vector3(W / 2 + stairRun, footY, z);
    const segmentLength = stairRun;
    railSegments.push({ from, to, normal: new THREE.Vector3(0, 0, sign), postAt: [0, segmentLength / 2, segmentLength], spacing: 0.2 });
  }
  const railing = buildRailSegments(seed + 211, railSegments);
  railing.name = 'banya-dock-rails';
  const benchPlan = { x: -1.1, z: front - 0.78, width: 1.2, depth: 0.44, floorY: top, seatY: top + 0.47 };
  const bench = buildBanyaBench(benchPlan, rnd);
  const roofSupportPoints = [-W / 2, W / 2].map((x) => new THREE.Vector3(x, eaveY, supportZ));
  const obstacles = [...railSegments, ...roofSupportPoints.map((point) => ({ point })), { bench: benchPlan }];
  const staircase = new THREE.Group().add(...stairs.meshes(), ...stringers.meshes());
  staircase.name = 'banya-stairs';
  houseDoor.name = 'banya-door';
  group.add(...boards.meshes(), staircase, roofExtension, rafters, roofSupports, railing, bench, houseDoor);
  const deck = (px, pz) => {
    const p = worldToLocal(px, pz), distance = front - p.z;
    if (Math.abs(p.x) <= W / 2 && distance >= 0 && distance <= length) return deckTop;
    if (p.x >= W / 2 && p.x <= W / 2 + stairRun && Math.abs(p.z - stairZ) <= stairWidth / 2) {
      const step = Math.min(treads, Math.floor((p.x - W / 2) / stairRun * treads) + 1);
      return base + top - step * rise;
    }
    return -Infinity;
  };
  const blocks = (px, pz) => {
    const p = worldToLocal(px, pz);
    if (Math.abs(p.x) < W / 2 + R + 0.25 && Math.abs(p.z) < D / 2 + R + 0.25) return true;
    if (obstacles.some((obstacle) => obstacle.bench
      ? Math.abs(p.x - obstacle.bench.x) < obstacle.bench.width / 2 + 0.2 && Math.abs(p.z - obstacle.bench.z) < obstacle.bench.depth / 2 + 0.18
      : obstacle.point
        ? Math.hypot(p.x - obstacle.point.x, p.z - obstacle.point.z) < 0.32
        : distanceToRail(p.x, p.z, obstacle.from, obstacle.to) < 0.23)) return true;
    return false;
  };
  const powerLine = buildBanyaPower(base, power, house, localToWorld);
  return { group, dock, powerLine, deck, blocks, plan, deckPlan, approach: { x: foot.x, z: foot.y } };
}

function distanceToRail(x, z, from, to) {
  const dx = to.x - from.x, dz = to.z - from.z, length2 = dx * dx + dz * dz;
  const t = THREE.MathUtils.clamp(((x - from.x) * dx + (z - from.z) * dz) / length2, 0, 1);
  return Math.hypot(x - from.x - t * dx, z - from.z - t * dz);
}

function buildBanyaRafters(shape, startZ, endZ, rnd) {
  const rafters = new Planks(boardMaterials(TONES.gable), 0.075), Z = new THREE.Vector3(0, 0, 1);
  for (let z = startZ; z > endZ - 0.05; z -= 0.75) {
    const z0 = Math.max(endZ, z - 0.045), z1 = Math.min(startZ, z + 0.045);
    for (const side of [-1, 1]) {
      const X = new THREE.Vector3(side * Math.cos(shape.pitch), -Math.sin(shape.pitch), 0);
      const normal = new THREE.Vector3(side * Math.sin(shape.pitch), Math.cos(shape.pitch), 0);
      const frame = { o: new THREE.Vector3(0, shape.ridge, 0).addScaledVector(normal, -0.09), X, Y: Z };
      rafters.add([[0, z0], [shape.length, z0], [shape.length, z1], [0, z1]],
        frame, normal, [1, 0], z1 - z0, rnd);
    }
  }
  const group = new THREE.Group().add(...rafters.meshes());
  group.name = 'banya-roof-rafters';
  return group;
}

function buildRoofSupports(z, startZ, x, floor, eave) {
  const group = new THREE.Group(), radius = R * 1.08;
  const beam = (a, b) => {
    const direction = b.clone().sub(a), length = direction.length();
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
    const mesh = new THREE.Mesh(geometry, LOG_MATERIAL);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (const side of [-1, 1]) {
    const at = side * x;
    beam(new THREE.Vector3(at, eave, startZ), new THREE.Vector3(at, eave, z));
    beam(new THREE.Vector3(at, floor, z), new THREE.Vector3(at, eave, z));
  }
  group.name = 'banya-roof-supports';
  return group;
}

function buildBanyaBench({ x, z, width, depth, floorY, seatY }, rnd) {
  const wood = boardMaterials(TONES.gable), seat = new Planks(wood, 0.035), frame = new Planks(wood, 0.07);
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1), up = UP;
  const frontZ = z - depth / 2, backZ = z + depth / 2, half = width / 2, legHeight = seatY - floorY - 0.035;
  for (let i = 0; i < 3; i++) {
    const a = frontZ + i * depth / 3, b = frontZ + (i + 1) * depth / 3 - 0.012;
    seat.add([[-half, a], [half, a], [half, b], [-half, b]],
      { o: new THREE.Vector3(x, seatY - 0.035, 0), X, Y: Z }, up, [1, 0], b - a, rnd);
  }
  for (const side of [-1, 1]) {
    const lx = x + side * (half - 0.055);
    for (const lz of [frontZ + 0.06, backZ - 0.06]) {
      frame.add([[-0.045, 0], [0.045, 0], [0.045, legHeight], [-0.045, legHeight]],
        { o: new THREE.Vector3(lx, floorY, lz), X: Z, Y: up }, X, [1, 0], 0.09, rnd);
    }
    const back = { o: new THREE.Vector3(lx, seatY - 0.02, backZ - 0.02), X: Z, Y: up };
    frame.add([[-0.04, 0], [0.04, 0], [0.04, 0.82], [-0.04, 0.82]],
      { ...back, X: new THREE.Vector3(0, 0.16, 0.987).normalize() }, X, [1, 0], 0.08, rnd);
    frame.add([[frontZ - backZ + 0.1, seatY + 0.16], [0.04, seatY + 0.16],
      [0.04, seatY + 0.23], [frontZ - backZ + 0.1, seatY + 0.23]],
    { o: new THREE.Vector3(lx, 0, backZ), X: Z, Y: up }, X, [1, 0], 0.08, rnd);
  }
  const backX = X, backY = new THREE.Vector3(0, Math.cos(0.16), Math.sin(0.16));
  for (let i = 0; i < 3; i++) {
    const y = 0.22 + i * 0.22;
    seat.add([[-half, y], [half, y], [half, y + 0.12], [-half, y + 0.12]],
      { o: new THREE.Vector3(x, seatY + 0.05, backZ + 0.03), X: backX, Y: backY },
      new THREE.Vector3(0, -Math.sin(0.16), Math.cos(0.16)), [1, 0], width, rnd);
  }
  const bench = new THREE.Group().add(...frame.meshes(), ...seat.meshes());
  bench.position.set(0, 0, 0);
  bench.name = 'banya-bench';
  return bench;
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
