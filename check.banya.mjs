import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true });
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: true });
globalThis.fetch = async (path) => ({ json: async () => JSON.parse(await readFile(path, 'utf8')) });

const { planRiver } = await import('./src/river.js');
const { shapeGround, groundGeometry, height } = await import('./src/terrain.js');
const { makeGround } = await import('./src/grass.js');
const { planBanya, buildBanya } = await import('./src/banya.js');
const { planHouse } = await import('./src/house.js');
const { planGas, gasPostMaterial } = await import('./src/gas.js');
const { planPower, powerWireMaterial } = await import('./src/power.js');
const { generator } = await import('./src/random.js');
const { GATES, WICKET } = await import('./src/fence.js');

for (const seed of [1, 2, 7, 42, 100, 1000, 4000, 9000]) {
  const house = planHouse(seed), rnd = generator(seed + 13);
  const door = house.openings.find((opening) => opening.kind === 'door').wall === 'right' ? 1 : -1;
  const side = -door, front = 1.5 + rnd();
  const atHouse = { x: GATES.at - door * (house.w / 2 + 5), z: 12.5 - front - house.d / 2 };
  const river = planRiver({ seed, back: -12.5 });
  const site = planBanya(seed, river, side);
  shapeGround(seed, [site.pad, { ...atHouse, w: house.w + 1, d: house.d + 1 }], 40, 25, { dug: river.dug, calm: river.calm, rows: river.rows });
  atHouse.y = height(atHouse.x, atHouse.z);
  const gas = planGas(house, atHouse, { fence: 12.5, gate: GATES.at });
  const power = planPower(house, atHouse, gas, { fence: 12.5, keep: [WICKET, GATES] });
  groundGeometry(40);
  const grassBounds = (x, z) => Math.abs(x) <= 20 && z <= 12.5 && z >= river.brow(x);
  const grassGround = makeGround(40, grassBounds);
  assert.ok(grassGround.material.map, 'плоская текстура травы подключена');
  assert.equal(grassGround.material.vertexColors, false, 'текстура земли не зависит от удалённой цветовой сетки');
  assert.equal(grassGround.geometry.attributes.color, undefined);
  assert.equal(grassGround.geometry.attributes.uv.count, grassGround.geometry.attributes.position.count);
  const grassPositions = grassGround.geometry.attributes.position;
  assert.ok(Math.min(...Array.from({ length: grassPositions.count }, (_, i) => grassPositions.getZ(i))) < -20,
    'текстурная трава доходит за край заднего двора к реке');
  for (let i = 0; i < grassPositions.count; i++) {
    const x = grassPositions.getX(i), z = grassPositions.getZ(i);
    assert.ok(Math.abs(x) <= 20.2, 'трава не выходит за боковые границы участка');
    assert.ok(z >= river.brow(x) - 0.5 && z <= 12.7, 'трава покрывает склон до кромки, не выходя за участок');
  }
  const banya = buildBanya(site, river, power, { plan: house, at: atHouse });
  const { start, along, across, length, top, width } = banya.deckPlan;
  const at = (distance, offset = 0) => start.clone().addScaledVector(along, distance).addScaledVector(across, offset);
  const end = at(length - 0.05), middle = at(length / 2);
  assert.ok(end.y < river.shore(end.x), 'настил выходит к воде');
  assert.ok(top > river.level(end.x), 'настил выше воды');
  assert.equal(banya.deck(middle.x, middle.y), top);
  assert.equal(banya.deck(...at(length / 2, width / 2 + 0.3).toArray()), -Infinity);
  assert.ok(banya.blocks(site.x, site.z));
  assert.ok(!banya.blocks(middle.x, middle.y));
  const c = Math.cos(site.angle), s = Math.sin(site.angle), stairZ = -2 - 0.13 - 0.8;
  const stairPoint = (x) => [site.x + c * x + s * stairZ, site.z - s * x + c * stairZ];
  const stairs = [2.05, 2.25, 2.45, 2.65, 2.85, 3.05].map((x) => banya.deck(...stairPoint(x)));
  assert.ok(stairs.every(Number.isFinite));
  assert.ok(stairs.every((y, i) => i === 0 || y <= stairs[i - 1]));
  const posts = banya.powerLine.children.filter((mesh) => mesh.material === gasPostMaterial);
  const wires = banya.powerLine.children.filter((mesh) => mesh.material === powerWireMaterial);
  assert.ok(posts.length > 0);
  assert.equal(wires.length, posts.length + 2);
  for (const post of posts) {
    post.geometry.computeBoundingBox();
    assert.ok(Math.abs(post.geometry.boundingBox.max.y - post.geometry.boundingBox.min.y - 2) < 1e-5);
  }
  for (const wire of wires) {
    const positions = wire.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const clearance = positions.getY(i) - height(positions.getX(i), positions.getZ(i));
      assert.ok(clearance > 1.7, `провод выше головы: ${clearance}`);
      assert.ok(Math.abs(positions.getX(i) - atHouse.x) > house.w / 2 || Math.abs(positions.getZ(i) - atHouse.z) > house.d / 2,
        `провод пересекает сруб: seed ${seed}, точка ${positions.getX(i)}, ${positions.getZ(i)}, дом ${atHouse.x}, ${atHouse.z}`);
    }
  }
  for (const part of [grassGround, banya.group, banya.dock, banya.powerLine]) part.traverse((o) => o.geometry?.dispose());
}
console.log('banya checks ok');
