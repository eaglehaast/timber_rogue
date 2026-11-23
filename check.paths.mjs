import assert from 'node:assert/strict';
import { ROUTE_SPACING, planPathNetwork } from './src/route.js';

function nearPoint(actual, expected) {
  assert.ok(Math.hypot(actual.x - expected.x, actual.z - expected.z) < 1e-6);
}

const yards = [
  {
    gate: { x: 10.3, z: 12.3 }, porch: { x: 8, z: 7 }, pad: { x: 18, z: 8 },
    bath: { x: -10, z: -3 }, house: { x: 2.3, z: 6, w: 8, d: 10 },
  },
  {
    gate: { x: 10.3, z: 12.3 }, porch: { x: 12, z: 7 }, pad: { x: 1, z: 8 },
    bath: { x: 10, z: -3 }, house: { x: 18.3, z: 6, w: 8, d: 10 },
  },
];

for (const yard of yards) {
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
  for (const point of bath.points) {
    const insideHouse = Math.abs(point.x - yard.house.x) < yard.house.w / 2 + 0.4
      && Math.abs(point.z - yard.house.z) < yard.house.d / 2 + 0.4;
    assert.equal(insideHouse, false);
  }
}
console.log('curved path network checks ok');
