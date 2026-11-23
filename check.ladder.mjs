import assert from 'node:assert/strict';
import * as THREE from 'three';

class ImageMock {
  addEventListener(name, fn) { this[`on${name}`] = fn; }
  removeEventListener() {}
  set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
  get src() { return this._src; }
}
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: () => new ImageMock(),
  createElement: (name) => name === 'canvas'
    ? { getContext: () => ({}) }
    : new ImageMock(),
};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true });
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: true });

const { advanceLadderClimb, buildLadder, findLadderPlacement, LADDER_LENGTH, ladderClimbPosition } = await import('./src/ladder.js');
const ladder = buildLadder();
assert.equal(ladder.children.length, 9, 'лестница состоит из двух стоек и семи перекладин');
const box = new THREE.Box3().setFromObject(ladder);
assert.ok(Math.abs(box.max.y - box.min.y - LADDER_LENGTH) < 1e-6);

const stem = {
  center: () => new THREE.Vector3(),
  outline: () => 0.3,
  contains: (x, y, z) => y > 0 && Math.hypot(x, z) <= 0.3,
};
const base = new THREE.Vector3(0, 0, 0);
const tree = {
  base,
  root: { position: base },
  standing: 1,
  voxels: { shape: { stems: [stem] } },
};
const ground = () => 0;
const placement = findLadderPlacement(
  [tree],
  new THREE.Vector3(0, 0, 2),
  new THREE.Vector3(0, 0, -1),
  ground,
);
assert.ok(placement, 'лестницу можно приставить к стоящему стволу перед игроком');
assert.ok(placement.up.y > 0.96 && placement.up.dot(placement.forward) > 0.2, 'примеренная лестница наклоняется к стволу');
assert.equal(findLadderPlacement([{ ...tree, standing: 0 }], new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, -1), ground), null);
assert.equal(findLadderPlacement(
  [{ ...tree, stumps: [2.3] }],
  new THREE.Vector3(0, 0, 2),
  new THREE.Vector3(0, 0, -1),
  ground,
), null, 'уровень спила выше верхней точки лестницы делает установку невозможной');
assert.ok(findLadderPlacement(
  [{ ...tree, stumps: [1.8] }],
  new THREE.Vector3(0, 0, 2),
  new THREE.Vector3(0, 0, -1),
  ground,
), 'уровень спила ниже верхней точки лестницы оставляет место для установки');
const foot = ladderClimbPosition(placement, 0);
const top = ladderClimbPosition(placement, placement.maxProgress);
assert.ok(foot.y < 0.01 && top.y > 1.8);
assert.ok(Math.abs(top.x - foot.x) < 0.7 && top.z < foot.z, 'при подъёме лестница приближается к стволу');
assert.equal(advanceLadderClimb(placement, 0, 1, 10).progress, placement.maxProgress, 'подъём ограничен верхней перекладиной');
assert.equal(advanceLadderClimb(placement, 0.2, -1, 1).leaveAtBottom, true, 'спуск до земли разрешает сойти');

console.log('ladder checks ok');
