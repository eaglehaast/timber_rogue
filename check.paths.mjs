import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fitPavingCenter, ROUTE_SPACING, planPathNetwork } from './src/route.js';

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
    ? { getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }
    : new ImageMock(),
};
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: true });
globalThis.fetch = async (path) => ({ json: async () => JSON.parse(await readFile(path, 'utf8')) });
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true });

function nearPoint(actual, expected) {
  assert.ok(Math.hypot(actual.x - expected.x, actual.z - expected.z) < 1e-6);
}

const yards = [
  {
    gate: { x: 0, z: 12.32 }, porch: { x: -3.2, z: 7 }, porchApproach: { x: -1.6, z: 7 },
    pad: { x: 10.35, z: 4.25 }, padApproach: { x: 9.15, z: 4.25 },
    bath: { x: -10, z: -3 }, bathApproach: { x: -8.4, z: -3 }, house: { x: -8, z: 6, w: 8, d: 10 },
  },
  {
    gate: { x: 0, z: 12.32 }, porch: { x: -4.1, z: 7.5 }, porchApproach: { x: -2.5, z: 7.5 },
    pad: { x: 10.35, z: 3.2 }, padApproach: { x: 9.15, z: 3.2 },
    bath: { x: -12, z: -3.5 }, bathApproach: { x: -10.4, z: -3.5 }, house: { x: -9, z: 6, w: 9, d: 10 },
  },
];

for (const center of [19.7, -19.7, 0]) {
  const fitted = fitPavingCenter(center, 4.6, 20, 0.45);
  assert.ok(Math.abs(fitted) + 4.6 <= 20 - 0.45);
}

for (const yard of yards) {
  assert.equal(yard.gate.x, 0);
  assert.ok(yard.porch.x < yard.gate.x && yard.pad.x > yard.gate.x);
  assert.ok(yard.pad.x - 4.6 > yard.gate.x + 1.7);
  assert.ok(yard.pad.x + 4.6 <= 20 - 0.45);
  assert.ok(yard.pad.z + 6.6 < yard.gate.z);
  const { junction, routes } = planPathNetwork(yard);
  assert.equal(routes.length, 4);
  nearPoint(routes[0].points[0], yard.gate);
  nearPoint(routes[0].points.at(-1), junction);
  const destinations = { house: yard.porch, utility: yard.pad, bath: yard.bath };
  for (const route of routes.slice(1)) {
    nearPoint(route.points[0], junction);
    nearPoint(route.points.at(-1), destinations[route.destination]);
    assert.ok(route.points.length > 3);
    for (let i = 1; i < route.points.length; i++) {
      const distance = Math.hypot(route.points[i].x - route.points[i - 1].x, route.points[i].z - route.points[i - 1].z);
      assert.ok(distance <= ROUTE_SPACING + 0.02);
    }
  }
  const bath = routes.find(({ destination }) => destination === 'bath');
  const approach = {
    house: yard.porch,
    utility: yard.pad,
    bath: yard.bath,
  };
  const guides = {
    house: yard.porchApproach,
    utility: yard.padApproach,
    bath: yard.bathApproach,
  };
  for (const route of routes.slice(1)) {
    const previous = route.points.at(-2), last = route.points.at(-1), guide = guides[route.destination];
    const actual = { x: last.x - previous.x, z: last.z - previous.z };
    const expected = { x: last.x - guide.x, z: last.z - guide.z };
    const dot = (actual.x * expected.x + actual.z * expected.z)
      / (Math.hypot(actual.x, actual.z) * Math.hypot(expected.x, expected.z));
    assert.ok(dot > 0.99, `${route.destination} approach must align with its final entry axis`);
    nearPoint(last, approach[route.destination]);
  }
  for (const point of bath.points) {
    const insideHouse = Math.abs(point.x - yard.house.x) < yard.house.w / 2 + 0.4
      && Math.abs(point.z - yard.house.z) < yard.house.d / 2 + 0.4;
    assert.equal(insideHouse, false);
  }
}

const { shapeGround, groundGeometry, groundAt } = await import('./src/terrain.js');
const { planPaths } = await import('./src/paths.js');
shapeGround(71, [], 40, 25);
groundGeometry(200);
const paths = planPaths({
  ...yards[0], seed: 71, pavingOrigin: { x: 14.95, z: 4.25 },
});
const meshes = paths.build().children;
assert.equal(meshes.length, 7);
let minY = Infinity, maxY = -Infinity;
for (const mesh of meshes.slice(0, 4)) {
  assert.equal(mesh.material.transparent, false);
  const positions = mesh.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    assert.ok(Math.abs(y - groundAt(x, z) - 0.015) < 1e-6);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
}
assert.ok(maxY - minY > 0.01, 'path mesh must follow the generated terrain variation');
const [sides, ends] = meshes.slice(5);
assert.equal(sides.name, 'path-border-sides');
assert.equal(ends.name, 'path-border-ends');
const tops = ends.geometry.attributes.position;
assert.ok(tops.count > 9 * 20, 'border has posts along the paths');
assert.equal(tops.count % 9, 0);
assert.equal(sides.geometry.attributes.position.count, tops.count * 2);
for (let i = 0; i < tops.count; i += 9) {
  const x = tops.getX(i), y = tops.getY(i), z = tops.getZ(i);
  for (let j = 0; j < 9; j++) {
    assert.ok(y - groundAt(tops.getX(i + j), tops.getZ(i + j)) >= 0.069,
      'post top must stay above the terrain across its footprint');
  }
  assert.ok(Math.hypot(x - paths.junction.x, z - paths.junction.z) >= 1.05);
  for (const [destination, endpoint, minimum] of [
    ['gate', yards[0].gate, 0.3], ['house', yards[0].porch, 0.8],
    ['utility', yards[0].pad, 1.4], ['bath', yards[0].bath, 0.8],
  ]) {
    assert.ok(Math.hypot(x - endpoint.x, z - endpoint.z) >= minimum,
      `border must leave the ${destination} entrance open`);
  }
}
console.log('curved path network checks ok');
