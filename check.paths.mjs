import assert from 'node:assert/strict';
import { ROUTE_TILE, snapRoute, axisRoute } from './src/route.js';

function turnCount(points) {
  let turns = 0;
  let previous = null;
  for (let i = 1; i < points.length; i++) {
    const current = Math.abs(points[i].x - points[i - 1].x) > 1e-6 ? 'x' : 'z';
    if (previous && previous !== current) turns++;
    previous = current;
  }
  return turns;
}

const from = { x: 8, z: 19.5 };
const porch = { x: 3, z: 8 };
const pad = { x: 14, z: 12 };

for (const [route, target, first] of [[axisRoute(from, porch, 'z'), porch, 'z'], [axisRoute(from, pad, 'x'), pad, 'x']]) {
  assert.deepEqual(route[0], from);
  assert.deepEqual(route.at(-1), target);
  assert.equal(turnCount(route), 1);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.z - b.z) < 1e-6);
  }
}

assert.equal(ROUTE_TILE, 0.7);
assert.equal(snapRoute(14.2), 14);
assert.equal(snapRoute(14.5), 14.7);
console.log('path route checks ok');
