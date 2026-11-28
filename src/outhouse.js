import * as THREE from 'three';
import { Planks, boardMaterials, GLOOM } from './attic.js';
import { generator } from './random.js';
import { height } from './terrain.js';

const WIDTH = 1.2, DEPTH = 1.4, FRONT = 2.45, BACK = 2.2;
const DOOR_WIDTH = 0.78, DOOR_BOTTOM = 0.08, DOOR_TOP = 1.98;
const WINDOW_WIDTH = 0.36, WINDOW_BOTTOM = 2.08, WINDOW_TOP = 2.29;
const boards = boardMaterials(new THREE.Color(0.31, 0.22, 0.16));
const trim = boardMaterials(new THREE.Color(0.24, 0.17, 0.12));
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const rect = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export function planOuthouse({ seed, yardWidth, street, river }) {
  const x = yardWidth / 2 - 1.8, z = -9;
  const pad = { x, z, w: DEPTH, d: WIDTH };
  if (street - (z + WIDTH / 2) < 10
    || [x - DEPTH / 2, x, x + DEPTH / 2].some((px) => z - WIDTH / 2 - river.shore(px) < 10)) {
    throw new RangeError('Для туалета нет места с отступом от улицы и воды');
  }
  return { seed, x, z, pad, approach: { x: x - DEPTH / 2, z },
    approachGuide: { x: x - DEPTH / 2 - 1.7, z }, approachWidth: DOOR_WIDTH };
}

export function buildOuthouse(site) {
  const rnd = generator(site.seed + 7301), group = new THREE.Group();
  group.name = 'outhouse';
  group.position.set(site.x, height(site.x, site.z), site.z);
  // Local +z is the door; the building faces toward the yard.
  group.rotation.y = -Math.PI / 2;
  const wall = new Planks(boards, 0.025), roof = new Planks(boards, 0.025);
  const frame = new Planks(trim, 0.055), door = new Planks(boards, 0.035), threshold = new Planks(trim, 0.16);
  const frameAt = (o, a, b) => ({ o, X: a, Y: b });
  const frontFrame = frameAt(new THREE.Vector3(0, 0, DEPTH / 2), X, Y);
  const backFrame = frameAt(new THREE.Vector3(0, 0, -DEPTH / 2), X, Y);
  const frontNormal = Z, backNormal = Z.clone().negate();
  const spacing = WIDTH / 10;
  for (let i = 0; i < 10; i++) {
    const a = -WIDTH / 2 + i * spacing, b = a + spacing - 0.003;
    wall.add(rect(a, b, 0, BACK), backFrame, backNormal, [0, 1], spacing, rnd);
    const left = Math.max(a, -WIDTH / 2), right = Math.min(b, -DOOR_WIDTH / 2);
    if (right > left) wall.add(rect(left, right, 0, FRONT), frontFrame, frontNormal, [0, 1], spacing, rnd);
    const left2 = Math.max(a, DOOR_WIDTH / 2), right2 = Math.min(b, WIDTH / 2);
    if (right2 > left2) wall.add(rect(left2, right2, 0, FRONT), frontFrame, frontNormal, [0, 1], spacing, rnd);
    const centerLeft = Math.max(a, -DOOR_WIDTH / 2), centerRight = Math.min(b, DOOR_WIDTH / 2);
    if (centerRight <= centerLeft) continue;
    wall.add(rect(centerLeft, centerRight, DOOR_TOP, WINDOW_BOTTOM), frontFrame, frontNormal, [0, 1], spacing, rnd);
    wall.add(rect(centerLeft, centerRight, WINDOW_TOP, FRONT), frontFrame, frontNormal, [0, 1], spacing, rnd);
    if (centerLeft < -WINDOW_WIDTH / 2) wall.add(rect(centerLeft, Math.min(centerRight, -WINDOW_WIDTH / 2),
      WINDOW_BOTTOM, WINDOW_TOP), frontFrame, frontNormal, [0, 1], spacing, rnd);
    if (centerRight > WINDOW_WIDTH / 2) wall.add(rect(Math.max(centerLeft, WINDOW_WIDTH / 2), centerRight,
      WINDOW_BOTTOM, WINDOW_TOP), frontFrame, frontNormal, [0, 1], spacing, rnd);
  }
  const roofY = (z) => BACK + (FRONT - BACK) * (z + DEPTH / 2) / DEPTH;
  for (const side of [-1, 1]) {
    const sideFrame = frameAt(new THREE.Vector3(side * WIDTH / 2, 0, 0), Z, Y);
    for (let i = 0; i < 12; i++) {
      const a = -DEPTH / 2 + i * DEPTH / 12, b = a + DEPTH / 12 - 0.003;
      wall.add([[a, 0], [b, 0], [b, roofY(b)], [a, roofY(a)]], sideFrame,
        X.clone().multiplyScalar(side), [0, 1], DEPTH / 12, rnd);
    }
  }
  const doorFrame = frameAt(new THREE.Vector3(0, 0, DEPTH / 2 + 0.006), X, Y);
  for (let i = 0; i < 6; i++) {
    const a = -DOOR_WIDTH / 2 + i * DOOR_WIDTH / 6;
    door.add(rect(a, a + DOOR_WIDTH / 6 - 0.002, DOOR_BOTTOM, DOOR_TOP),
      doorFrame, Z, [0, 1], DOOR_WIDTH / 6, rnd);
  }
  const doorGroup = new THREE.Group().add(...door.meshes());
  doorGroup.name = 'outhouse-closed-door';
  group.add(...wall.meshes(), doorGroup);
  for (const side of [-1, 1]) frame.add(rect(side * (DOOR_WIDTH / 2 + 0.015) - 0.04,
    side * (DOOR_WIDTH / 2 + 0.015) + 0.04, 0, DOOR_TOP + 0.07), doorFrame, Z, [0, 1], 0.08, rnd);
  frame.add(rect(-DOOR_WIDTH / 2 - 0.055, DOOR_WIDTH / 2 + 0.055, DOOR_TOP, DOOR_TOP + 0.07),
    doorFrame, Z, [1, 0], 0.07, rnd);
  for (const side of [-1, 1]) frame.add(rect(side * (WINDOW_WIDTH / 2 + 0.015) - 0.025,
    side * (WINDOW_WIDTH / 2 + 0.015) + 0.025, WINDOW_BOTTOM - 0.04, WINDOW_TOP + 0.04),
  doorFrame, Z, [0, 1], 0.05, rnd);
  for (const y of [WINDOW_BOTTOM - 0.04, WINDOW_TOP]) frame.add(
    rect(-WINDOW_WIDTH / 2 - 0.04, WINDOW_WIDTH / 2 + 0.04, y, y + 0.04),
    doorFrame, Z, [1, 0], 0.04, rnd);
  threshold.add(rect(-DOOR_WIDTH / 2, DOOR_WIDTH / 2, -0.08, 0.12),
    frameAt(new THREE.Vector3(0, -0.05, DEPTH / 2), X, Z), Y, [1, 0], 0.2, rnd);
  const alongRoof = new THREE.Vector3(0, (FRONT - BACK) / DEPTH, 1);
  const roofFrame = frameAt(new THREE.Vector3(0, roofY(0) + 0.035, 0), X, alongRoof);
  const roofNormal = new THREE.Vector3(0, 1, -(FRONT - BACK) / DEPTH).normalize();
  for (let i = 0; i < 12; i++) {
    const a = -WIDTH / 2 - 0.12 + i * (WIDTH + 0.24) / 12;
    const b = a + (WIDTH + 0.24) / 12 - 0.002;
    roof.add(rect(a, b, -DEPTH / 2 - 0.15, DEPTH / 2 + 0.2),
      roofFrame, roofNormal, [0, 1], (WIDTH + 0.24) / 12, rnd);
  }
  const window = new THREE.Group();
  window.name = 'outhouse-transom';
  const windowSize = [WINDOW_WIDTH, WINDOW_TOP - WINDOW_BOTTOM];
  const windowY = (WINDOW_BOTTOM + WINDOW_TOP) / 2;
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(...windowSize), new THREE.MeshBasicMaterial({ color: 0x506671 }));
  backing.position.set(0, windowY, DEPTH / 2 - 0.025);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(...windowSize),
    new THREE.MeshPhongMaterial({ color: 0xb7d2de, specular: 0xffffff, shininess: 100, transparent: true, opacity: 0.55, depthWrite: false }));
  glass.name = 'outhouse-window-glass';
  glass.position.set(0, windowY, DEPTH / 2 + 0.015);
  const gleam = new THREE.Shape();
  gleam.moveTo(-0.15, -0.085);
  gleam.lineTo(-0.125, -0.085);
  gleam.lineTo(-0.045, 0.085);
  gleam.lineTo(-0.07, 0.085);
  gleam.closePath();
  const reflection = new THREE.Mesh(new THREE.ShapeGeometry(gleam),
    new THREE.MeshBasicMaterial({ color: 0xe7f5ff, transparent: true, opacity: 0.24, depthWrite: false }));
  reflection.position.set(0, windowY, DEPTH / 2 + 0.016);
  window.add(backing, glass, reflection);
  const sill = new THREE.Group().add(...threshold.meshes());
  sill.name = 'outhouse-threshold';
  group.add(...frame.meshes(), sill, ...roof.meshes(), window);
  const iron = new THREE.MeshLambertMaterial({ color: 0x332f2b });
  for (const y of [0.35, 1.7]) {
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.035, 0.012), iron);
    hinge.position.set(-DOOR_WIDTH / 2 + 0.065, y, DEPTH / 2 + 0.05);
    group.add(hinge);
  }
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.13, 0.025), iron);
  latch.position.set(DOOR_WIDTH / 2 - 0.09, 1.05, DEPTH / 2 + 0.06);
  group.add(latch);
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_WIDTH, DOOR_TOP - DOOR_BOTTOM), GLOOM);
  dark.position.set(0, (DOOR_BOTTOM + DOOR_TOP) / 2, DEPTH / 2 - 0.01);
  group.add(dark);
  return group;
}

export function outhouseBlocks(site, x, z, radius = 0) {
  return Math.abs(x - site.x) < DEPTH / 2 + radius && Math.abs(z - site.z) < WIDTH / 2 + radius;
}
