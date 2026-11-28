import * as THREE from 'three';
import { planHouse, buildHouse, R, COURSE, PLINTH, logMaterials } from './house.js';
import { PANE, LINING } from './window.js';
import { buildDoor, buildRailSegments } from './porch.js';
import { Planks, boardMaterials, TONES, buildRoofExtension } from './attic.js';
import { height } from './terrain.js';
import { generator } from './random.js';
import { gasPostMaterial } from './gas.js';
import { powerWireMaterial } from './power.js';
import { curve, sag, tube } from './pipe.js';

const W = 4, D = 4, POLE_HEIGHT = 2, SPAN = 4;
const UP = new THREE.Vector3(0, 1, 0);
const BANYA_FRAME = { deck: 0.035, beam: 0.2, pile: 0.24, pileSpacing: 1.35, joistSpacing: 0.85, pileDrive: 0.4 };
const ROOF_SUPPORT_CLEARANCE = 0.025, ROOF_BOARD_THICKNESS = 0.022;
const BANYA_LOGS = logMaterials(2.4), BANYA_GABLE = TONES.gable.clone().multiplyScalar(2.2);
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
    gableTone: BANYA_GABLE,
    plinthHeight: PLINTH + 0.06, plinthOut: 0.025, plinthCap: true, noDrip: true };
  const group = buildHouse(plan, { logs: BANYA_LOGS });
  group.position.set(x, base, z);
  group.rotation.y = angle;
  const localToWorld = (lx, lz) => new THREE.Vector2(x + Math.cos(angle) * lx + Math.sin(angle) * lz,
    z - Math.sin(angle) * lx + Math.cos(angle) * lz);
  const worldToLocal = (px, pz) => {
    const dx = px - x, dz = pz - z;
    return { x: Math.cos(angle) * dx - Math.sin(angle) * dz, z: Math.sin(angle) * dx + Math.cos(angle) * dz };
  };

  // Дверь и настил используют те же доски, что изба и мостки.
  const front = -D / 2 - R, top = PLINTH + door.bottom;
  const houseDoor = buildDoor(seed + 211, door, { along: 'x', at: -D / 2 }, { base: PLINTH, face: R });
  const start = localToWorld(0, front), along = new THREE.Vector2(-Math.sin(angle), -Math.cos(angle));
  const across = new THREE.Vector2(Math.cos(angle), -Math.sin(angle));
  const shore = river.shore(start.x);
  const length = Math.max(2.5, (start.y - shore) / Math.cos(angle) + 0.8);
  const riverEnd = front - length, sideOuter = W / 2 + 1.65, sideBack = 0.9;
  const deckTop = base + top;
  const deckPlan = { seed: seed + 211, start, along, across, top: deckTop, length, land: 0, width: W, riverEnd, sideOuter, sideBack };
  const dock = buildBanyaDeck(seed + 211, { top, front, riverEnd, sideBack, sideOuter, site, base });
  dock.position.set(x, base, z);
  dock.rotation.y = angle;
  const roofShape = group.userData.roofShape;
  const roofEndZ = riverEnd - 0.35, roofStartZ = -roofShape.zEnd;
  const roofExtension = buildRoofExtension(plan, roofShape, roofEndZ);
  const rafters = buildBanyaRafters(roofShape, roofStartZ, roofEndZ, rnd);
  const supportZ = riverEnd + 0.25, roofSupportX = W / 2 - 0.1;
  const roofSupports = buildRoofSupports(supportZ, roofStartZ + 0.2, roofSupportX, top, roofShape);
  roofSupports.userData.roofEndZ = roofEndZ;
  const beamRadius = R * 1.08;
  const eaveY = roofShape.ridge - roofSupportX * Math.tan(roofShape.pitch)
    - (beamRadius + ROOF_BOARD_THICKNESS + ROOF_SUPPORT_CLEARANCE) / Math.cos(roofShape.pitch);
  // Боковая площадка огибает сруб и выводит лестницу на сухую сторону, вдоль стены.
  const stairX = W / 2 + 0.93, stairWidth = 1.1, stairRun = 1.2;
  const foot = localToWorld(stairX, sideBack + stairRun);
  const approachGuide = localToWorld(stairX, sideBack + stairRun + 1.6);
  let footY = -Infinity;
  for (let dx = -stairWidth / 2; dx <= stairWidth / 2 + 0.001; dx += 0.11) {
    for (let dz = 0; dz <= stairRun + 0.001; dz += 0.12) {
      const p = localToWorld(stairX + dx, sideBack + dz);
      footY = Math.max(footY, height(p.x, p.y) - base);
    }
  }
  footY += 0.02;
  const stairs = new Planks(boardMaterials(TONES.gable), 0.035);
  const risers = Math.max(2, Math.ceil((top - footY) / 0.17)), treads = risers - 1, rise = (top - footY) / risers;
  const x0 = stairX - stairWidth / 2, x1 = stairX + stairWidth / 2;
  const stairFrame = { o: new THREE.Vector3(0, 0, 0), X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 0, 1) };
  for (let i = 0; i < treads; i++) {
    const a = sideBack + i * stairRun / treads, b = sideBack + (i + 1) * stairRun / treads;
    const treadY = top - (i + 1) * rise;
    stairs.add([[x0, a], [x1, a], [x1, b], [x0, b]],
      { ...stairFrame, o: new THREE.Vector3(0, treadY - 0.035, 0) }, UP, [0, 1], stairRun / treads, rnd);
    const upperY = top - i * rise;
    stairs.add([[x0, treadY], [x1, treadY], [x1, upperY], [x0, upperY]],
      { o: new THREE.Vector3(0, 0, a), X: new THREE.Vector3(1, 0, 0), Y: UP },
      new THREE.Vector3(0, 0, 1), [1, 0], stairWidth, rnd);
  }
  const stringers = new Planks(boardMaterials(TONES.gable), 0.055);
  for (const sign of [-1, 1]) {
    const x = stairX + sign * (stairWidth / 2 - 0.025);
    stringers.add([[sideBack - 0.04, top - 0.08], [sideBack + stairRun + 0.04, footY - 0.08],
      [sideBack + stairRun + 0.04, footY - 0.2], [sideBack - 0.04, top - 0.2]],
    { o: new THREE.Vector3(x, 0, 0), X: new THREE.Vector3(0, 0, 1), Y: UP },
    new THREE.Vector3(sign, 0, 0), [1, 0], stairRun, rnd);
  }
  const railSegments = [];
  const rail = (x0, d0, x1, d1, normal, postStep = 0.8, omitEndPost = false) => {
    const segmentLength = Math.hypot(x1 - x0, d1 - d0), postAt = [0];
    for (let d = postStep; d < segmentLength - 0.12; d += postStep) postAt.push(d);
    if (!omitEndPost) postAt.push(segmentLength);
    railSegments.push({
      from: new THREE.Vector3(x0, top, front - d0), to: new THREE.Vector3(x1, top, front - d1),
      normal, postAt,
    });
  };
  rail(-W / 2, 0, -W / 2, length, new THREE.Vector3(-1, 0, 0));
  rail(W / 2, 0, W / 2, front - sideBack, new THREE.Vector3(1, 0, 0));
  rail(sideOuter, length, sideOuter, front - sideBack, new THREE.Vector3(1, 0, 0));
  rail(W / 2, front - sideBack, x0, front - sideBack, new THREE.Vector3(0, 0, 1));
  rail(x1, front - sideBack, sideOuter, front - sideBack, new THREE.Vector3(0, 0, 1));
  rail(-W / 2, length, sideOuter, length, new THREE.Vector3(0, 0, -1), 0.8, true);
  for (const sign of [-1, 1]) {
    const x = stairX + sign * (stairWidth / 2 - 0.025);
    const from = new THREE.Vector3(x, top, sideBack), to = new THREE.Vector3(x, footY, sideBack + stairRun);
    const segmentLength = stairRun;
    railSegments.push({ from, to, normal: new THREE.Vector3(sign, 0, 0), postAt: [0, segmentLength / 2, segmentLength], spacing: 0.2 });
  }
  const railing = buildRailSegments(seed + 211, railSegments);
  railing.name = 'banya-dock-rails';
  const benchPlan = { x: -1.1, z: front - 0.78, width: 1.2, depth: 0.44, floorY: top, seatY: top + 0.47 };
  const bench = buildBanyaBench(benchPlan, rnd);
  const roofSupportPoints = [-roofSupportX, roofSupportX].map((x) => new THREE.Vector3(x, eaveY, supportZ));
  const obstacles = [...railSegments, ...roofSupportPoints.map((point) => ({ point })), { bench: benchPlan }];
  const staircase = new THREE.Group().add(...stairs.meshes(), ...stringers.meshes());
  staircase.name = 'banya-stairs';
  houseDoor.name = 'banya-door';
  group.add(staircase, roofExtension, rafters, roofSupports, railing, bench, houseDoor);
  const deck = (px, pz) => {
    const p = worldToLocal(px, pz), distance = front - p.z;
    if (Math.abs(p.x) <= W / 2 && distance >= 0 && distance <= length) return deckTop;
    if (p.x >= W / 2 && p.x <= sideOuter && p.z >= riverEnd && p.z <= sideBack) return deckTop;
    if (p.z >= sideBack && p.z <= sideBack + stairRun && Math.abs(p.x - stairX) <= stairWidth / 2) {
      const step = Math.min(treads, Math.floor((p.z - sideBack) / stairRun * treads) + 1);
      return base + top - step * rise;
    }
    return -Infinity;
  };
  const blocks = (px, pz) => {
    const p = worldToLocal(px, pz);
    const body = Math.abs(p.x) < W / 2 + R + 0.25 && Math.abs(p.z) < D / 2 + R + 0.25;
    const doorway = Math.abs(p.x) < door.width / 2 && p.z >= front - 0.3 && p.z <= -D / 2 + 0.35;
    if (body && !doorway) return true;
    if (obstacles.some((obstacle) => obstacle.bench
      ? Math.abs(p.x - obstacle.bench.x) < obstacle.bench.width / 2 + 0.2 && Math.abs(p.z - obstacle.bench.z) < obstacle.bench.depth / 2 + 0.18
      : obstacle.point
        ? Math.hypot(p.x - obstacle.point.x, p.z - obstacle.point.z) < 0.32
        : distanceToRail(p.x, p.z, obstacle.from, obstacle.to) < 0.23)) return true;
    return false;
  };
  const powerLine = buildBanyaPower(base, power, house, localToWorld);
  return {
    group, dock, powerLine, deck, blocks, plan, deckPlan,
    approach: { x: foot.x, z: foot.y }, approachGuide: { x: approachGuide.x, z: approachGuide.y }, approachWidth: stairWidth,
  };
}

function distanceToRail(x, z, from, to) {
  const dx = to.x - from.x, dz = to.z - from.z, length2 = dx * dx + dz * dz;
  const t = THREE.MathUtils.clamp(((x - from.x) * dx + (z - from.z) * dz) / length2, 0, 1);
  return Math.hypot(x - from.x - t * dx, z - from.z - t * dz);
}

function addTimber(planks, from, to, width, rnd) {
  const axis = to.clone().sub(from), length = axis.length();
  if (length < 0.03) return;
  axis.normalize();
  const reference = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  const u = axis.clone().cross(reference).normalize(), v = axis.clone().cross(u).normalize();
  const half = width / 2, rect = [[0, 0], [length, 0], [length, width], [0, width]];
  const face = (o, Y, normal, faceWidth) => planks.add(rect,
    { o, X: axis, Y }, normal, [1, 0], faceWidth, rnd);
  face(from.clone().addScaledVector(u, -half).addScaledVector(v, half), v.clone().negate(), u, width);
  face(from.clone().addScaledVector(u, -half).addScaledVector(v, -half), v, u.clone().negate(), width);
  face(from.clone().addScaledVector(u, half).addScaledVector(v, -half), u, v, width);
  face(from.clone().addScaledVector(u, -half).addScaledVector(v, -half), u.clone().negate(), v.clone().negate(), width);
  planks.add([[0, 0], [width, 0], [width, width], [0, width]],
    { o: to.clone().addScaledVector(u, -half).addScaledVector(v, -half), X: u, Y: v },
    axis, [1, 0], width, rnd);
  planks.add([[0, 0], [width, 0], [width, width], [0, width]],
    { o: from.clone().addScaledVector(u, -half).addScaledVector(v, half), X: u, Y: v.clone().negate() },
    axis.clone().negate(), [1, 0], width, rnd);
}

function buildBanyaDeck(seed, { top, front, riverEnd, sideBack, sideOuter, site, base }) {
  const rnd = generator(seed + 97), floor = new Planks(boardMaterials(TONES.roof), BANYA_FRAME.deck);
  const frame = new Planks(boardMaterials(TONES.gable), 0.018), wetFrame = new Planks(
    boardMaterials(TONES.gable.clone().multiplyScalar(0.68)), 0.018);
  const upper = top - BANYA_FRAME.deck, beamBottom = upper - BANYA_FRAME.beam, beamY = beamBottom + BANYA_FRAME.beam / 2;
  const mainHalf = W / 2, plankLength = 0.1;
  let z1 = front;
  while (z1 > riverEnd + 1e-4) {
    const z0 = Math.max(riverEnd, z1 - plankLength);
    floor.add([[-mainHalf, z0], [mainHalf, z0], [mainHalf, z1], [-mainHalf, z1]],
      { o: new THREE.Vector3(0, upper, 0), X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 0, 1) },
      UP, [1, 0], z1 - z0, rnd);
    const annexZ1 = Math.min(z1, sideBack);
    if (annexZ1 > z0 + 1e-4) {
      floor.add([[mainHalf, z0], [sideOuter, z0], [sideOuter, annexZ1], [mainHalf, annexZ1]],
        { o: new THREE.Vector3(0, upper, 0), X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 0, 1) },
        UP, [1, 0], annexZ1 - z0, rnd);
    }
    z1 = z0 - 0.01 - rnd() * 0.014;
  }

  const world = (lx, lz) => ({
    x: site.x + Math.cos(site.angle) * lx + Math.sin(site.angle) * lz,
    z: site.z - Math.sin(site.angle) * lx + Math.cos(site.angle) * lz,
  });
  const supportXs = [-mainHalf + 0.1, 0, mainHalf - 0.1, sideOuter - 0.1];
  const supportEnds = new Map(supportXs.map((x) => [x, x > mainHalf ? sideBack : front]));
  for (const [x, endZ] of supportEnds) {
    addTimber(frame, new THREE.Vector3(x, beamY, riverEnd), new THREE.Vector3(x, beamY, endZ), BANYA_FRAME.beam, rnd);
  }
  const joist = (z, x0, x1) => addTimber(frame, new THREE.Vector3(x0, beamY, z),
    new THREE.Vector3(x1, beamY, z), BANYA_FRAME.beam, rnd);
  for (let z = riverEnd; z <= front + 1e-4; z += BANYA_FRAME.joistSpacing) {
    joist(Math.min(z, front), -mainHalf, z <= sideBack ? sideOuter : mainHalf);
  }
  joist(riverEnd, -mainHalf, sideOuter);
  joist(front, -mainHalf, mainHalf);
  joist(sideBack, mainHalf, sideOuter);

  const piles = [];
  for (const [x, endZ] of supportEnds) {
    const count = Math.max(1, Math.ceil((endZ - riverEnd) / BANYA_FRAME.pileSpacing));
    const zPositions = Array.from({ length: count + 1 }, (_, i) => THREE.MathUtils.lerp(riverEnd, endZ, i / count));
    if (Math.abs(Math.abs(x) - (mainHalf - 0.1)) < 1e-5) zPositions.push(riverEnd + 0.25);
    for (const z of [...new Set(zPositions)].sort((a, b) => a - b)) {
      const point = world(x, z);
      const ground = height(point.x, point.z) - base;
      const bottom = Math.min(ground - BANYA_FRAME.pileDrive, beamBottom - 0.35);
      const headY = beamBottom - 0.045;
      const postStart = new THREE.Vector3(x, bottom, z), postEnd = new THREE.Vector3(x, headY, z);
      addTimber(bottom < headY - 0.35 ? wetFrame : frame, postStart, postEnd, BANYA_FRAME.pile, rnd);
      addTimber(frame, new THREE.Vector3(x, beamBottom - 0.055, z),
        new THREE.Vector3(x, beamBottom + 0.015, z), BANYA_FRAME.pile + 0.06, rnd);
      piles.push({ x, z, bottom, top: headY, ground });
    }
  }
  const braceXs = [-mainHalf + 0.1, 0, mainHalf - 0.1, sideOuter - 0.1];
  for (const x of braceXs) {
    const post = piles.find((pile) => Math.abs(pile.x - x) < 1e-5 && Math.abs(pile.z - riverEnd) < 1e-5);
    if (!post || post.top - post.bottom < 0.9) continue;
    const inward = x > mainHalf ? -1 : 1;
    addTimber(frame, new THREE.Vector3(x + inward * 0.52, post.bottom + 0.42, riverEnd + 0.58),
      new THREE.Vector3(x, beamBottom - 0.12, riverEnd + 0.08), 0.14, rnd);
  }
  const deck = new THREE.Group().add(...floor.meshes(), ...frame.meshes(), ...wetFrame.meshes());
  deck.name = 'banya-veranda-deck';
  deck.userData.plan = { front, riverEnd, sideBack, sideOuter, top, upper, beamBottom };
  deck.userData.piles = piles;
  return deck;
}

function buildBanyaRafters(shape, startZ, endZ, rnd) {
  const rafters = new Planks(boardMaterials(TONES.gable.clone().multiplyScalar(1.7)), 0.09), Z = new THREE.Vector3(0, 0, 1);
  const positions = [];
  for (let z = startZ; z > endZ + 0.3; z -= 0.75) positions.push(z);
  if (!positions.length || positions.at(-1) - endZ > 0.3) positions.push(endZ);
  for (const z of positions) {
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
  const ridgeBeam = new Planks(boardMaterials(TONES.gable.clone().multiplyScalar(1.7)), 0.018);
  addTimber(ridgeBeam, new THREE.Vector3(0, shape.ridge - 0.1, startZ),
    new THREE.Vector3(0, shape.ridge - 0.1, endZ), 0.15, rnd);
  const ridge = new THREE.Group().add(...ridgeBeam.meshes());
  ridge.name = 'banya-roof-ridge-beam';
  group.add(ridge);
  group.userData.roofShape = { ridge: shape.ridge, startZ, endZ };
  group.name = 'banya-roof-rafters';
  return group;
}

function buildRoofSupports(z, startZ, x, floor, shape) {
  const group = new THREE.Group(), radius = R * 1.08, roofClearance = ROOF_SUPPORT_CLEARANCE;
  const timberMaterial = BANYA_LOGS[0];
  const beam = (a, b) => {
    const direction = b.clone().sub(a), length = direction.length();
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
    const mesh = new THREE.Mesh(geometry, timberMaterial);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    mesh.name = 'banya-roof-longitudinal-beam';
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (const side of [-1, 1]) {
    const at = side * x;
    const roofY = shape.ridge - x * Math.tan(shape.pitch);
    const normalGap = radius + ROOF_BOARD_THICKNESS + roofClearance;
    const eave = roofY - normalGap / Math.cos(shape.pitch);
    beam(new THREE.Vector3(at, eave, startZ), new THREE.Vector3(at, eave, z));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.84, radius * 0.84, eave - radius - floor, 12), timberMaterial);
    post.position.set(at, (eave - radius + floor) / 2, z);
    post.name = 'banya-roof-post';
    post.castShadow = post.receiveShadow = true;
    group.add(post);
    const baseBlock = new Planks(boardMaterials(TONES.gable), 0.018);
    addTimber(baseBlock, new THREE.Vector3(at, floor, z), new THREE.Vector3(at, floor + 0.08, z), radius * 2.2, generator(211 + side));
    group.add(...baseBlock.meshes());
  }
  group.userData.crossbeam = eaveYFor(shape, x, radius, roofClearance) - radius - floor >= 2.4;
  if (group.userData.crossbeam) {
    const y = eaveYFor(shape, x, radius, roofClearance);
    beam(new THREE.Vector3(-x, y, z), new THREE.Vector3(x, y, z));
    group.children.at(-1).name = 'banya-roof-crossbeam';
  }
  group.userData.radius = radius;
  group.userData.roofClearance = roofClearance;
  group.userData.roofShape = { ridge: shape.ridge, pitch: shape.pitch, x };
  group.name = 'banya-roof-supports';
  return group;
}

function eaveYFor(shape, x, radius, clearance) {
  return shape.ridge - x * Math.tan(shape.pitch)
    - (radius + ROOF_BOARD_THICKNESS + clearance) / Math.cos(shape.pitch);
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
