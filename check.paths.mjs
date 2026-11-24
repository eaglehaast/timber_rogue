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
    porchWidth: 2.4, bathWidth: 1.1,
    pad: { x: 10.35, z: 4.25 }, padApproach: { x: 9.15, z: 4.25 },
    bath: { x: -10, z: -3 }, bathApproach: { x: -8.4, z: -3 }, house: { x: -8, z: 6, w: 8, d: 10 },
  },
  {
    gate: { x: 0, z: 12.32 }, porch: { x: -4.1, z: 7.5 }, porchApproach: { x: -2.5, z: 7.5 },
    porchWidth: 1.6, bathWidth: 1.1,
    pad: { x: 10.35, z: 3.2 }, padApproach: { x: 9.15, z: 3.2 },
    bath: { x: -12, z: -3.5 }, bathApproach: { x: -10.4, z: -3.5 }, house: { x: -9, z: 6, w: 9, d: 10 },
  },
  {
    gate: { x: 0, z: 12.32 }, porch: { x: -2.17, z: 9.053737149108201 }, porchApproach: { x: -0.57, z: 9.053737149108201 },
    porchWidth: 2.4, bathWidth: 1.1, pad: { x: 10.35, z: 4.25 }, padApproach: { x: 9.15, z: 4.25 },
    bath: { x: -7.2362315264, z: -25.5441550465 }, bathApproach: { x: -5.651624237, z: -25.765559063 },
    house: { x: -6.8750787973, z: 7.5537371491, w: 9.5201580524, d: 6.7 },
  },
];

for (const center of [19.7, -19.7, 0]) {
  const fitted = fitPavingCenter(center, 4.6, 20, 0.45);
  assert.ok(Math.abs(fitted) + 4.6 <= 20 - 0.45);
}

const seed42House = planPathNetwork(yards[2]).routes[1].points;
let reversal = 0;
for (let i = 1; i < seed42House.length; i++) reversal += Math.max(0, seed42House[i].x - seed42House[i - 1].x);
assert.ok(reversal < 0.04, 'the seed 42 porch approach must not loop back over itself');

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
const { yardPavingOutline, yardPavingContains } = await import('./src/campfire.js');
const { exposedPavingEdges, borderPoints } = await import('./src/paving-contour.js');
const rectangle = (x0, x1) => {
  const polygon = [{ x: x0, z: 0 }, { x: x1, z: 0 }, { x: x1, z: 2 }, { x: x0, z: 2 }];
  return { polygon, edges: polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]]) };
};
const unionEdges = exposedPavingEdges([rectangle(0, 2), rectangle(1, 3)]);
const unionPosts = borderPoints(unionEdges, 0.105);
assert.ok(unionPosts.every(({ x, z }) => Math.abs(z) < 1e-6 || Math.abs(z - 2) < 1e-6
  || Math.abs(x) < 1e-6 || Math.abs(x - 3) < 1e-6), 'overlap must not leave a barrier inside paving');
shapeGround(71, [], 40, 25);
groundGeometry(200);
const pavingOrigin = { x: 14.95, z: 4.25 };
const pavingOutline = yardPavingOutline.map((p) => ({ x: p.x + pavingOrigin.x, z: p.z + pavingOrigin.z }));
const paths = planPaths({
  ...yards[0], seed: 71, pavingOrigin, pavingOutline,
});
const meshes = paths.build().children;
assert.equal(meshes.length, 7);
for (const [i, width] of [[1, yards[0].porchWidth], [3, yards[0].bathWidth]]) {
  const pos = meshes[i].geometry.attributes.position, last = pos.count - 17;
  assert.ok(Math.abs(Math.hypot(pos.getX(last) - pos.getX(last + 16), pos.getZ(last) - pos.getZ(last + 16)) - width) < 1e-5,
    'path must meet the full width of the stairs');
}
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
  assert.ok(!(x > yards[0].pad.x + 0.12 && Math.abs(z - yards[0].pad.z) < 0.65
    && x < yards[0].pad.x + 1.2), 'border must not cross the entrance to the utility paving');
}
const posts = Array.from({ length: tops.count / 9 }, (_, i) => ({ x: tops.getX(i * 9), z: tops.getZ(i * 9) }));
for (const [a, b] of unionEdges) for (let t = 0; t <= 1; t += 0.05) {
  const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
  assert.ok(unionPosts.some((p) => Math.hypot(x - p.x, z - p.z) < 0.08),
    'exposed boundary must be continuously edged');
}
assert.ok(posts.some((p) => p.x > pavingOrigin.x + 3), 'utility paving has a border on its far side');
for (const p of posts) {
  const inside = (x, z) => yardPavingContains(x - pavingOrigin.x, z - pavingOrigin.z);
  assert.ok(![[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]].every(([dx, dz]) => inside(p.x + dx, p.z + dz)),
    'border must not obstruct the interior of utility paving');
}
const segmentPairs = (line) => line.slice(1).map((p, i) => [line[i], p]);
const shapes = meshes.slice(0, 4).flatMap(({ geometry }) => {
  const pos = geometry.attributes.position, left = [], right = [];
  for (let i = 0; i < pos.count; i += 17) {
    left.push({ x: pos.getX(i), z: pos.getZ(i) });
    right.push({ x: pos.getX(i + 16), z: pos.getZ(i + 16) });
  }
  return left.slice(1).map((_, i) => ({
    polygon: [left[i], left[i + 1], right[i + 1], right[i]],
    edges: [[left[i], left[i + 1]], [right[i], right[i + 1]]],
  }));
});
function insidePolygon(polygon, x, z) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const insidePaths = (x, z) => shapes.some(({ polygon }) => insidePolygon(polygon, x, z));
for (const p of posts) assert.ok(![[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]
  .every(([dx, dz]) => insidePaths(p.x + dx, p.z + dz)), 'border must not obstruct the interior of a path');
const circle = Array.from({ length: 32 }, (_, i) => ({
  x: paths.junction.x + 0.92 * Math.cos(i * Math.PI / 16),
  z: paths.junction.z + 0.92 * Math.sin(i * Math.PI / 16),
}));
shapes.push({ polygon: circle, edges: segmentPairs([...circle, circle[0]]) });
shapes.push({ polygon: pavingOutline, edges: segmentPairs(pavingOutline).filter(([a, b]) =>
  !(Math.abs(a.x - yards[0].pad.x) < 1e-5 && Math.abs(b.x - yards[0].pad.x) < 1e-5)) });
for (const [a, b] of exposedPavingEdges(shapes)) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.04);
  for (let i = 0; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
    assert.ok(posts.some((p) => Math.hypot(x - p.x, z - p.z) < 0.08),
      `uncovered paving boundary at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
}
function assertNoPostsInsideRenderedPaths(parts, label = '') {
  const cells = new Map(), cellSize = 0.5;
  for (const mesh of parts.slice(0, 5)) {
    const pos = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [0, 1, 2].map((j) => {
        const k = index.getX(i + j);
        return { x: pos.getX(k) + mesh.position.x, z: pos.getZ(k) + mesh.position.z };
      });
      const x0 = Math.floor(Math.min(...triangle.map((p) => p.x)) / cellSize);
      const x1 = Math.floor(Math.max(...triangle.map((p) => p.x)) / cellSize);
      const z0 = Math.floor(Math.min(...triangle.map((p) => p.z)) / cellSize);
      const z1 = Math.floor(Math.max(...triangle.map((p) => p.z)) / cellSize);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(triangle);
      }
    }
  }
  const inside = (x, z) => (cells.get(`${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`) ?? [])
    .some((triangle) => insidePolygon(triangle, x, z));
  const pos = parts[6].geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 9) {
    const x = pos.getX(i), z = pos.getZ(i);
    assert.ok(![[0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]].every(([dx, dz]) => inside(x + dx, z + dz)),
      `${label}: post inside rendered path at ${x.toFixed(4)}, ${z.toFixed(4)}; center=${inside(x, z)}, near=${[[0.001, 0], [-0.001, 0], [0, 0.001], [0, -0.001]].map(([dx, dz]) => inside(x + dx, z + dz))}`);
  }
}
assertNoPostsInsideRenderedPaths(meshes);
const seed42 = planPaths({ ...yards[2], seed: 42, pavingOrigin, pavingOutline }).build().children;
assertNoPostsInsideRenderedPaths(seed42);
const seed42Porch = seed42[1].geometry.attributes.position, end = seed42Porch.count - 17;
assert.ok(Math.abs(Math.hypot(seed42Porch.getX(end) - seed42Porch.getX(end + 16),
  seed42Porch.getZ(end) - seed42Porch.getZ(end + 16)) - 2.4) < 1e-5, 'seed 42 path meets the wide stair');
for (const [seed, x, z, width] of [[1, -1.7, 8.5, 1.6], [7, -2.8, 7.5, 2.4],
  [100, -4.5, 9.5, 1.6], [1000, -3.2, 6.7, 2.4]]) {
  const yard = { ...yards[2], porch: { x, z }, porchApproach: { x: x + 1.6, z }, porchWidth: width };
  assertNoPostsInsideRenderedPaths(planPaths({ ...yard, seed, pavingOrigin, pavingOutline }).build().children, `seed ${seed}`);
}
console.log('curved path network checks ok');
