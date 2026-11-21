import assert from 'node:assert/strict';
import { ROUTE_TILE, axisRoute } from './src/route.js';

function turnCount(points) {
  let turns = 0, previous = null;
  for (let i = 1; i < points.length; i++) {
    const direction = Math.abs(points[i].x - points[i - 1].x) > 1e-6 ? 'x' : 'z';
    if (previous && previous !== direction) turns++;
    previous = direction;
  }
  return turns;
}

const from = { x: 8, z: 19.5 };
for (const [target, first] of [[{ x: 3, z: 8 }, 'z'], [{ x: 14, z: 12 }, 'x']]) {
  const points = axisRoute(from, target, first);
  assert.deepEqual(points[0], from);
  assert.deepEqual(points.at(-1), target);
  assert.equal(turnCount(points), 1);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.z - b.z) < 1e-6);
  }
}
assert.equal(ROUTE_TILE, 0.7);
console.log('path route checks ok');
