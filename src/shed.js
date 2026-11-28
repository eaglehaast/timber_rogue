import * as THREE from 'three';
import { Planks, boardMaterials } from './attic.js';
import { buildCover } from './roof.js';
import { generator } from './random.js';
import { height } from './terrain.js';
import { merge } from './surface.js';

// Конёк вдоль левого забора (+z), ворота смотрят во двор (+x).
const HX = 1.3, HZ = 2.65, BAY = 0.8, POST = 0.12, FLOOR = 0.075;
const EAVE = 2.10, PITCH = Math.PI / 11, ridge = EAVE + HX * Math.tan(PITCH);
const rackFront = -0.53, rackEnd = HZ - 0.18;
const DOOR_A = -1.96, DOOR_B = 0.12, APRON = 1.5;
const timber = boardMaterials(new THREE.Color(0.40, 0.31, 0.22));
const fadedGreen = boardMaterials(new THREE.Color(0.19, 0.30, 0.25));
const iron = new THREE.MeshLambertMaterial({ color: 0x484441 });
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const rect = (a, b, low, top) => [[a, low], [b, low], [b, top], [a, top]];
const front = (x) => ({ o: new THREE.Vector3(x, 0, 0), X: Z, Y });
const end = (z) => ({ o: new THREE.Vector3(0, 0, z), X, Y });
const level = (y) => ({ o: new THREE.Vector3(0, y, 0), X, Y: Z });

// Мощёная площадка вдоль фасада: от косяка ворот до торца открытого пролёта, створки распахиваются над ней.
// Бордюр идёт по трём открытым сторонам; у стены его нет, у ворот он отступает от обшивки.
export function planShed(yardWidth) {
  const x = -yardWidth / 2 + 3.6, z = -11, wall = x + HX;
  const gate = { z0: z + DOOR_A, z1: z + DOOR_B }, bay = { z0: z + BAY, z1: z + HZ };
  const apron = { x0: wall, x1: wall + APRON, z0: gate.z0 - 0.3, z1: bay.z1 + 0.1 };
  const corners = [{ x: wall + 0.1, z: apron.z0 }, { x: apron.x1, z: apron.z0 }, { x: apron.x1, z: apron.z1 }, { x: wall, z: apron.z1 }];
  apron.edges = corners.slice(1).map((p, i) => [corners[i], p]);
  const mouth = (apron.z0 + apron.z1) / 2;
  return {
    x, z, w: 2 * HX, d: 2 * HZ, wall, gate, bay, apron,
    approach: { x: apron.x1 - 0.15, z: mouth }, approachGuide: { x: apron.x1 + 1.4, z: mouth }, approachWidth: 2.5,
  };
}

export function onShedFloor(site, x, z, margin = 0) {
  return Math.abs(x - site.x) <= HX + margin && Math.abs(z - site.z) <= HZ + margin;
}

export function shedDeck(site, x, z) {
  return z >= site.z + BAY && onShedFloor(site, x, z) ? height(site.x, site.z) + FLOOR : -Infinity;
}

export function shedBlocks(site, x, z, margin = 0) {
  if (!onShedFloor(site, x, z, margin)) return false;
  const u = x - site.x, v = z - site.z;
  return v <= BAY + margin || u <= -HX + POST + margin
    || (u <= rackFront + margin && v <= rackEnd + margin)
    || (u >= HX - POST - margin && (v <= BAY + POST + margin || v >= HZ - POST - margin));
}

export function buildShed(site, seed) {
  const group = new THREE.Group(), rnd = generator(seed + 4817);
  group.name = 'shed';
  group.position.set(site.x, height(site.x, site.z), site.z);
  const wood = new Planks(timber), leaves = new Planks(fadedGreen), metal = [];
  const plank = (plane, n, a, b, low, top, vertical, thick, batch = wood) =>
    batch.add(rect(a, b, low, top), plane, n, vertical ? [0, 1] : [1, 0], vertical ? b - a : top - low, rnd, thick);
  const brace = (plane, n, a, y, b, h, width) => {
    const len = Math.hypot(b - a, h - y), dx = (b - a) / len, dy = (h - y) / len;
    const ex = -dy * width / 2, ey = dx * width / 2;
    wood.add([[a - ex, y - ey], [b - ex, h - ey], [b + ex, h + ey], [a + ex, y + ey]],
      plane, n, [dx, dy], width, rnd, 0.035);
  };
  const boards = (a, b, width, add) => {
    const count = Math.ceil((b - a) / width), step = (b - a) / count;
    for (let i = 0; i < count; i++) add(a + i * step, a + (i + 1) * step - 0.003);
  };
  const doorA = DOOR_A, doorB = DOOR_B, mid = (doorA + doorB) / 2, doorTop = 1.94;
  const wall = front(HX), back = front(-HX), backNormal = X.clone().negate();
  for (const [a, b, low] of [[-HZ, doorA, 0], [doorA, doorB, doorTop], [doorB, BAY, 0]]) {
    boards(a, b, 0.16, (l, r) => plank(wall, X, l, r, low, EAVE, true, 0.025));
  }
  boards(-HZ, BAY, 0.16, (l, r) => plank(back, backNormal, l, r, 0, EAVE, true, 0.025));
  const roofY = (x) => ridge - Math.abs(x) * Math.tan(PITCH);
  for (const [z, dir] of [[-HZ, -1], [BAY, 1]]) {
    const plane = end(z), n = Z.clone().multiplyScalar(dir);
    for (const [a, b] of [[-HX, 0], [0, HX]]) boards(a, b, 0.16, (l, r) => {
      wood.add([[l, 0], [r, 0], [r, roofY(r)], [l, roofY(l)]], plane, n, [0, 1], r - l, rnd);
    });
  }
  for (const [a, b, sign] of [[doorA, mid - 0.012, 1], [mid + 0.012, doorB, -1]]) {
    boards(a, b, 0.145, (l, r) => plank(wall, X, l, r, FLOOR, doorTop - 0.012, true, 0.038, leaves));
    const face = front(HX + 0.038), hinge = sign > 0 ? a : b, meeting = sign > 0 ? b : a;
    for (const y of [0.26, 1.66]) {
      plank(face, X, a, b, y, y + 0.11, false, 0.035);
      metal.push(new THREE.BoxGeometry(0.014, 0.046, 0.33).translate(HX + 0.079, y + 0.055, hinge + sign * 0.14));
    }
    brace(face, X, hinge + sign * 0.045, 0.37, meeting - sign * 0.045, 1.66, 0.085);
  }
  metal.push(new THREE.BoxGeometry(0.037, 0.05, 0.27).translate(HX + 0.055, 1.06, mid));
  for (const z of [doorA - 0.075, doorB]) plank(wall, X, z, z + 0.075, 0, doorTop, true, 0.075);
  plank(wall, X, doorA - 0.075, doorB + 0.075, doorTop, doorTop + 0.09, false, 0.075);

  // Открытый пролёт: сквозная задняя стенка, подшитый свес на стойках и запас тёса на подкладках.
  for (const x of [-HX, HX - POST]) {
    for (const z of [BAY, HZ - POST]) plank(front(x), X, z, z + POST, 0, EAVE - POST, true, POST);
    plank(front(x), X, BAY, HZ, EAVE - POST, EAVE, false, POST);
    brace(front(x + 0.04), X, HZ - POST / 2, EAVE - 0.58, HZ - 0.46, EAVE - POST, 0.09);
  }
  for (let y = 0.24; y < EAVE - 0.2; y += 0.28) plank(back, backNormal, BAY, HZ, y, y + 0.14, false, 0.025);
  plank(end(HZ - POST), Z, -HX, HX, EAVE - POST, EAVE, false, POST);
  boards(-HX, HX, 0.17, (l, r) => plank(level(-0.02), Y, l, r, BAY, HZ, true, FLOOR + 0.02));
  plank(level(-0.02), Y, HX - 0.08, HX + 0.10, doorA, doorB, true, FLOOR + 0.02);
  const rackBack = -HX + POST;
  let stackY = FLOOR;
  for (let row = 0; row < 7; row++) {
    if (row % 3 === 0) {
      for (const z of [BAY + 0.35, rackEnd - 0.25]) plank(level(stackY), Y, rackBack, rackFront, z, z + 0.07, false, 0.055);
      stackY += 0.055;
    }
    boards(rackBack + 0.015, rackFront - row * 0.014, 0.15, (l, r) =>
      plank(level(stackY), Y, l, r, BAY + 0.08 + rnd() * 0.09, rackEnd - rnd() * 0.08, true, 0.045));
    stackY += 0.045;
  }

  // Дощатая подшивка видна снизу; волны, торцы листов и конёк даёт та же кровля, что на доме.
  const zEnd = HZ + 0.23, halfRoof = HX + 0.26, length = halfRoof / Math.cos(PITCH);
  for (const sign of [-1, 1]) {
    const along = new THREE.Vector3(sign * Math.cos(PITCH), -Math.sin(PITCH), 0);
    for (const z of [BAY + 0.025, (BAY + HZ) / 2, HZ - POST]) {
      const e = sign * halfRoof, y = roofY(e);
      wood.add([[0, ridge], [e, y], [e, y - 0.11], [0, ridge - 0.11]],
        end(z), Z, [along.x, along.y], 0.11, rnd, POST);
    }
    const plane = { o: new THREE.Vector3(0, ridge, 0), X: along, Y: Z };
    const n = new THREE.Vector3(sign * Math.sin(PITCH), Math.cos(PITCH), 0);
    boards(0, length, 0.18, (l, r) => plank(plane, n, l, r, -zEnd, zEnd, true, 0.035));
  }
  const cover = buildCover('slate', { ridge, pitch: PITCH, length, zEnd }, rnd);
  cover.name = 'shed-slate';
  const fittings = new THREE.Mesh(merge(metal), iron);
  fittings.castShadow = true;
  group.add(...wood.meshes(), ...leaves.meshes(), fittings, cover);
  return group;
}
